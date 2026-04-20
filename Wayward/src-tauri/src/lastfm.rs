use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

const LASTFM_API_ROOT: &str = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_API_KEY_ENV: &str = "LASTFM_API_KEY";

#[derive(Serialize, Clone, Debug, Default)]
pub struct LastfmContext {
    source: LastfmSource,
    similar_tracks: Vec<LastfmTrackMatch>,
    top_albums: Vec<LastfmAlbumMatch>,
}

#[derive(Serialize, Clone, Debug, Default)]
struct LastfmSource {
    url: Option<String>,
    listeners: Option<String>,
    playcount: Option<String>,
    tags: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
struct LastfmTrackMatch {
    name: String,
    artist: String,
    album: Option<String>,
    image_url: Option<String>,
    url: Option<String>,
    match_score: Option<f64>,
}

#[derive(Serialize, Clone, Debug, Default)]
struct LastfmAlbumMatch {
    name: String,
    artist: String,
    image_url: Option<String>,
    url: Option<String>,
    listeners: Option<String>,
    rank: Option<u32>,
}

#[allow(dead_code)]
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LastfmSetupStatus {
    Checking,
    Missing,
    Invalid,
    Ready,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LastfmSetupState {
    pub status: LastfmSetupStatus,
    pub message: Option<String>,
}

impl LastfmSetupState {
    fn missing(message: impl Into<Option<String>>) -> Self {
        Self {
            status: LastfmSetupStatus::Missing,
            message: message.into(),
        }
    }

    fn invalid(message: impl Into<Option<String>>) -> Self {
        Self {
            status: LastfmSetupStatus::Invalid,
            message: message.into(),
        }
    }

    fn ready(message: impl Into<Option<String>>) -> Self {
        Self {
            status: LastfmSetupStatus::Ready,
            message: message.into(),
        }
    }
}

#[tauri::command]
pub async fn get_lastfm_setup_state() -> LastfmSetupState {
    let env_path = resolve_write_env_path();

    let stored_key = match read_lastfm_api_key_from_env_file(&env_path) {
        Ok(api_key) => api_key,
        Err(error) => return LastfmSetupState::invalid(Some(error)),
    };

    inspect_lastfm_setup_state(stored_key).await
}

#[tauri::command]
pub async fn submit_lastfm_api_key(api_key: String) -> Result<LastfmSetupState, String> {
    let trimmed_key = validate_api_key(&api_key)?.to_string();
    verify_lastfm_api_key(&trimmed_key).await?;

    let env_path = resolve_write_env_path();
    upsert_lastfm_api_key(&env_path, &trimmed_key)?;
    env::set_var(LASTFM_API_KEY_ENV, &trimmed_key);

    Ok(LastfmSetupState::ready(None))
}

#[tauri::command]
pub async fn lookup_lastfm_context(
    artist: String,
    track: String,
    album_title: Option<String>,
) -> Result<LastfmContext, String> {
    let trimmed_artist = artist.trim();
    let trimmed_track = track.trim();
    let trimmed_album_title = album_title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if trimmed_artist.is_empty() || trimmed_track.is_empty() {
        return Err("A track title and artist are required for Last.fm lookups.".to_string());
    }

    eprintln!(
        "[lastfm] lookup seed artist='{trimmed_artist}' track='{trimmed_track}' album={:?}",
        trimmed_album_title
    );

    let client = build_lastfm_client()?;
    let track_candidates = build_track_lookup_candidates(trimmed_track);
    let mut first_error: Option<String> = None;

    for track_candidate in &track_candidates {
        let (context, candidate_error) = fetch_context_candidate(
            &client,
            trimmed_artist,
            track_candidate,
            trimmed_album_title,
        )
        .await;

        if context_has_data(&context) {
            eprintln!(
                "[lastfm] lookup result artist='{trimmed_artist}' track='{track_candidate}' tags={} similar_tracks={} top_albums={}",
                context.source.tags.len(),
                context.similar_tracks.len(),
                context.top_albums.len()
            );
            return Ok(context);
        }

        if let Some(error) = candidate_error {
            first_error.get_or_insert(error);
        }
    }

    Err(first_error.unwrap_or_else(|| {
        "Last.fm did not return any metadata for the current song.".to_string()
    }))
}

pub fn load_local_env() {
    for candidate in env_candidate_paths() {
        if dotenvy::from_path(&candidate).is_ok() {
            eprintln!("[env] loaded {}", candidate.display());
            return;
        }
    }
}

async fn inspect_lastfm_setup_state(api_key: Option<String>) -> LastfmSetupState {
    let Some(api_key) = api_key else {
        return missing_lastfm_setup_state();
    };

    setup_state_from_verification(verify_lastfm_api_key(&api_key).await)
}

fn missing_lastfm_setup_state() -> LastfmSetupState {
    LastfmSetupState::missing(Some(
        "Enter your Last.fm API key to unlock recommendations.".to_string(),
    ))
}

fn setup_state_from_verification(verification: Result<(), String>) -> LastfmSetupState {
    match verification {
        Ok(()) => LastfmSetupState::ready(None),
        Err(error) => LastfmSetupState::invalid(Some(format!(
            "Saved Last.fm API key failed verification: {error}"
        ))),
    }
}

fn current_workdir() -> PathBuf {
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn project_root_dir() -> PathBuf {
    let cwd = current_workdir();
    let in_src_tauri = cwd
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("src-tauri"))
        .unwrap_or(false);

    if in_src_tauri {
        cwd.parent().unwrap_or(&cwd).to_path_buf()
    } else {
        cwd
    }
}

fn project_root_env_path() -> PathBuf {
    project_root_dir().join(".env")
}

fn env_candidate_paths() -> Vec<PathBuf> {
    let cwd = current_workdir();
    let mut candidates = vec![cwd.join(".env"), project_root_env_path()];
    candidates.dedup();
    candidates
}

fn resolve_write_env_path() -> PathBuf {
    env_candidate_paths()
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(project_root_env_path)
}

fn read_lastfm_api_key_from_env_file(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let entries = dotenvy::from_path_iter(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;

    for entry in entries {
        let (key, value) =
            entry.map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;

        if key == LASTFM_API_KEY_ENV {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed.to_string()));
            }
        }
    }

    Ok(None)
}

fn upsert_lastfm_api_key(path: &Path, api_key: &str) -> Result<(), String> {
    let trimmed_key = validate_api_key(api_key)?;
    let existing = if path.exists() {
        fs::read_to_string(path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?
    } else {
        String::new()
    };

    let had_trailing_newline = existing.ends_with('\n');
    let mut updated_lines = Vec::new();
    let mut replaced = false;

    for line in existing.lines() {
        if env_line_key(line).is_some_and(|key| key == LASTFM_API_KEY_ENV) {
            if !replaced {
                updated_lines.push(format!("{LASTFM_API_KEY_ENV}={trimmed_key}"));
                replaced = true;
            }
            continue;
        }

        updated_lines.push(line.to_string());
    }

    if !replaced {
        updated_lines.push(format!("{LASTFM_API_KEY_ENV}={trimmed_key}"));
    }

    let mut updated = updated_lines.join("\n");
    if updated.is_empty() || had_trailing_newline || existing.is_empty() {
        updated.push('\n');
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to prepare {}: {error}", parent.display()))?;
    }

    fs::write(path, updated).map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn env_line_key(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let (key, _) = trimmed.split_once('=')?;
    if key.is_empty() {
        return None;
    }

    let valid = key
        .chars()
        .all(|character| character == '_' || character.is_ascii_alphanumeric());

    if valid { Some(key) } else { None }
}

fn validate_api_key(api_key: &str) -> Result<&str, String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        Err("A Last.fm API key is required.".to_string())
    } else {
        Ok(trimmed)
    }
}

fn build_lastfm_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Wayward/0.1.0")
        .build()
        .map_err(|error| format!("Failed to create Last.fm client: {error}"))
}

async fn verify_lastfm_api_key(api_key: &str) -> Result<(), String> {
    let trimmed_key = validate_api_key(api_key)?;
    let client = build_lastfm_client()?;

    fetch_method_with_api_key(
        &client,
        "chart.gettopartists",
        vec![("limit".to_string(), "1".to_string())],
        Some(trimmed_key),
    )
    .await
    .map(|_| ())
}

async fn fetch_context_candidate(
    client: &Client,
    artist: &str,
    track: &str,
    album_title: Option<&str>,
) -> (LastfmContext, Option<String>) {
    let mut first_error: Option<String> = None;

    let track_info = match fetch_method(
        client,
        "track.getInfo",
        vec![
            ("artist".to_string(), artist.to_string()),
            ("track".to_string(), track.to_string()),
        ],
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            first_error.get_or_insert(error);
            Value::Null
        }
    };

    let track_tags = match fetch_method(
        client,
        "track.getTopTags",
        vec![
            ("artist".to_string(), artist.to_string()),
            ("track".to_string(), track.to_string()),
        ],
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            first_error.get_or_insert(error);
            Value::Null
        }
    };

    let similar_tracks = match fetch_method(
        client,
        "track.getSimilar",
        vec![
            ("artist".to_string(), artist.to_string()),
            ("track".to_string(), track.to_string()),
            ("limit".to_string(), "8".to_string()),
        ],
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            first_error.get_or_insert(error);
            Value::Null
        }
    };

    let top_albums = match fetch_method(
        client,
        "artist.getTopAlbums",
        vec![
            ("artist".to_string(), artist.to_string()),
            ("limit".to_string(), "8".to_string()),
        ],
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            first_error.get_or_insert(error);
            Value::Null
        }
    };

    let mut context = LastfmContext {
        source: parse_source(&track_info, &track_tags),
        similar_tracks: parse_similar_tracks(&similar_tracks),
        top_albums: parse_top_albums(&top_albums),
    };

    if let Some(current_album) = album_title {
        let current_album = normalize_name(current_album);
        context
            .top_albums
            .retain(|album| normalize_name(&album.name) != current_album);
    }

    context.similar_tracks.truncate(6);
    context.top_albums.truncate(6);

    (context, first_error)
}

async fn fetch_method(
    client: &Client,
    method: &str,
    params: Vec<(String, String)>,
) -> Result<Value, String> {
    fetch_method_with_api_key(client, method, params, None).await
}

async fn fetch_method_with_api_key(
    client: &Client,
    method: &str,
    params: Vec<(String, String)>,
    api_key_override: Option<&str>,
) -> Result<Value, String> {
    let api_key = match api_key_override {
        Some(api_key) => validate_api_key(api_key)?.to_string(),
        None => env::var(LASTFM_API_KEY_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                format!(
                    "{LASTFM_API_KEY_ENV} is not set; Last.fm lookup is unavailable for {method}."
                )
            })?,
    };

    let mut query = vec![
        ("method".to_string(), method.to_string()),
        ("api_key".to_string(), api_key),
        ("format".to_string(), "json".to_string()),
        ("autocorrect".to_string(), "1".to_string()),
    ];
    query.extend(params);

    let response = client
        .get(LASTFM_API_ROOT)
        .query(&query)
        .send()
        .await
        .map_err(|error| format!("Last.fm request failed for {method}: {error}"))?;

    let status = response.status();
    let payload = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Last.fm response for {method}: {error}"))?;

    if !status.is_success() {
        return Err(format!("Last.fm returned HTTP {status} for {method}."));
    }

    let json: Value = serde_json::from_str(&payload)
        .map_err(|error| format!("Failed to parse Last.fm response for {method}: {error}"))?;

    if let Some(code) = json.get("error").and_then(Value::as_i64) {
        let message = as_non_empty_string(json.get("message"))
            .unwrap_or_else(|| "Unknown Last.fm error".to_string());
        return Err(format!("Last.fm error {code} for {method}: {message}"));
    }

    Ok(json)
}

fn parse_source(track_info: &Value, track_tags: &Value) -> LastfmSource {
    let track = track_info.get("track").unwrap_or(&Value::Null);
    let mut tags = extract_tag_names(track.get("toptags").and_then(|value| value.get("tag")));

    if tags.is_empty() {
        tags = extract_tag_names(track_tags.get("toptags").and_then(|value| value.get("tag")));
    }

    LastfmSource {
        url: as_non_empty_string(track.get("url")),
        listeners: as_non_empty_string(track.get("listeners")),
        playcount: as_non_empty_string(track.get("playcount")),
        tags,
    }
}

fn parse_similar_tracks(payload: &Value) -> Vec<LastfmTrackMatch> {
    collect_items(payload.get("similartracks").and_then(|value| value.get("track")))
        .into_iter()
        .filter_map(|entry| {
            let name = as_non_empty_string(entry.get("name"))?;
            let artist = as_non_empty_string(entry.get("artist").and_then(|value| value.get("name")))
                .or_else(|| as_non_empty_string(entry.get("artist")))?;

            Some(LastfmTrackMatch {
                name,
                artist,
                album: as_non_empty_string(entry.get("album").and_then(|value| value.get("title")))
                    .or_else(|| as_non_empty_string(entry.get("album"))),
                image_url: extract_image_url(entry),
                url: as_non_empty_string(entry.get("url")),
                match_score: as_f64(entry.get("match")),
            })
        })
        .collect()
}

fn parse_top_albums(payload: &Value) -> Vec<LastfmAlbumMatch> {
    collect_items(payload.get("topalbums").and_then(|value| value.get("album")))
        .into_iter()
        .filter_map(|entry| {
            let name = as_non_empty_string(entry.get("name"))?;
            let artist = as_non_empty_string(entry.get("artist").and_then(|value| value.get("name")))
                .or_else(|| as_non_empty_string(entry.get("artist")))?;

            Some(LastfmAlbumMatch {
                name,
                artist,
                image_url: extract_image_url(entry),
                url: as_non_empty_string(entry.get("url")),
                listeners: as_non_empty_string(entry.get("playcount"))
                    .or_else(|| as_non_empty_string(entry.get("listeners"))),
                rank: entry
                    .get("@attr")
                    .and_then(|value| value.get("rank"))
                    .and_then(|value| as_u32(Some(value))),
            })
        })
        .collect()
}

fn collect_items<'a>(value: Option<&'a Value>) -> Vec<&'a Value> {
    match value {
        Some(Value::Array(items)) => items.iter().collect(),
        Some(item @ Value::Object(_)) => vec![item],
        _ => Vec::new(),
    }
}

fn extract_tag_names(value: Option<&Value>) -> Vec<String> {
    collect_items(value)
        .into_iter()
        .filter_map(|entry| as_non_empty_string(entry.get("name")).or_else(|| as_non_empty_string(Some(entry))))
        .take(4)
        .collect()
}

fn extract_image_url(entry: &Value) -> Option<String> {
    let images = match entry.get("image") {
        Some(Value::Array(images)) => images,
        _ => return None,
    };

    for size in ["extralarge", "large", "medium", "small"] {
        if let Some(url) = images.iter().find_map(|image| {
            let matches_size = image
                .get("size")
                .and_then(Value::as_str)
                .map(|value| value.eq_ignore_ascii_case(size))
                .unwrap_or(false);

            if matches_size {
                as_non_empty_string(image.get("#text"))
            } else {
                None
            }
        }) {
            return Some(url);
        }
    }

    images
        .iter()
        .find_map(|image| as_non_empty_string(image.get("#text")))
}

fn as_non_empty_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn as_f64(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn as_u32(value: Option<&Value>) -> Option<u32> {
    match value? {
        Value::Number(number) => number.as_u64().and_then(|number| u32::try_from(number).ok()),
        Value::String(text) => text.trim().parse::<u32>().ok(),
        _ => None,
    }
}

fn normalize_name(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn context_has_data(context: &LastfmContext) -> bool {
    !context.source.tags.is_empty()
        || !context.similar_tracks.is_empty()
        || !context.top_albums.is_empty()
}

fn build_track_lookup_candidates(track: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    push_lookup_candidate(&mut candidates, collapse_whitespace(track));
    push_lookup_candidate(&mut candidates, normalize_lookup_title(track));
    candidates
}

fn push_lookup_candidate(candidates: &mut Vec<String>, candidate: String) {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return;
    }

    if candidates
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(trimmed))
    {
        return;
    }

    candidates.push(trimmed.to_string());
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_lookup_title(value: &str) -> String {
    let mut normalized = collapse_whitespace(value);

    loop {
        let stripped_brackets =
            strip_trailing_lookup_enclosure(&normalized).unwrap_or_else(|| normalized.clone());
        let stripped_suffix =
            strip_trailing_lookup_suffix(&stripped_brackets).unwrap_or(stripped_brackets.clone());

        if stripped_suffix == normalized {
            break;
        }

        normalized = stripped_suffix;
    }

    normalized
}

fn strip_trailing_lookup_enclosure(value: &str) -> Option<String> {
    let closing = value.chars().last()?;
    let opening = match closing {
        ')' => '(',
        ']' => '[',
        '}' => '{',
        _ => return None,
    };

    let closing_start = value.len() - closing.len_utf8();
    let opening_index = value[..closing_start].rfind(opening)?;
    let inner = value[opening_index + opening.len_utf8()..closing_start].trim();

    if !is_lookup_decorator(inner) {
        return None;
    }

    Some(collapse_whitespace(value[..opening_index].trim_end()))
}

fn strip_trailing_lookup_suffix(value: &str) -> Option<String> {
    for separator in [" - ", " \u{2013} ", " \u{2014} ", ": "] {
        let Some(index) = value.rfind(separator) else {
            continue;
        };

        let head = value[..index].trim_end();
        let suffix = value[index + separator.len()..].trim();

        if head.is_empty() || !is_lookup_decorator(suffix) {
            continue;
        }

        return Some(collapse_whitespace(head));
    }

    None
}

fn is_lookup_decorator(value: &str) -> bool {
    let normalized = normalize_name(value);

    [
        "feat",
        "ft.",
        "with ",
        "live",
        "remaster",
        "remix",
        "mix",
        "version",
        "edit",
        "mono",
        "stereo",
        "acoustic",
        "instrumental",
        "karaoke",
        "bonus",
        "radio edit",
        "clean",
        "explicit",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_temp_env_path(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);

        env::temp_dir().join(format!(
            "wayward-{label}-{}-{counter}-{stamp}.env",
            process::id()
        ))
    }

    fn read_file(path: &Path) -> String {
        fs::read_to_string(path).expect("expected test env file to exist")
    }

    #[test]
    fn upsert_creates_env_file_when_missing() {
        let path = unique_temp_env_path("create");

        upsert_lastfm_api_key(&path, "fresh-key").expect("expected env upsert to succeed");

        assert_eq!(read_file(&path), "LASTFM_API_KEY=fresh-key\n");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn upsert_replaces_existing_key_and_preserves_other_lines() {
        let path = unique_temp_env_path("replace");
        fs::write(
            &path,
            "FOO=bar\nLASTFM_API_KEY=old-key\nKEEP=true\nLASTFM_API_KEY=duplicate\n",
        )
        .expect("expected test env file to be written");

        upsert_lastfm_api_key(&path, "new-key").expect("expected env upsert to succeed");

        let contents = read_file(&path);
        assert!(contents.contains("FOO=bar\n"));
        assert!(contents.contains("KEEP=true\n"));
        assert!(contents.contains("LASTFM_API_KEY=new-key\n"));
        assert_eq!(contents.matches("LASTFM_API_KEY=").count(), 1);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn upsert_rejects_blank_keys() {
        let path = unique_temp_env_path("blank");

        let error = upsert_lastfm_api_key(&path, "   ").expect_err("expected blank key failure");

        assert_eq!(error, "A Last.fm API key is required.");
        assert!(!path.exists());
    }

    #[test]
    fn read_key_returns_none_for_missing_file() {
        let path = unique_temp_env_path("missing");

        let key = read_lastfm_api_key_from_env_file(&path).expect("expected missing file read");

        assert_eq!(key, None);
    }

    #[test]
    fn setup_state_is_missing_without_a_key() {
        let state = missing_lastfm_setup_state();

        assert_eq!(state.status, LastfmSetupStatus::Missing);
    }

    #[test]
    fn setup_state_is_ready_for_verified_keys() {
        let state = setup_state_from_verification(Ok(()));

        assert_eq!(state.status, LastfmSetupStatus::Ready);
        assert_eq!(state.message, None);
    }

    #[test]
    fn setup_state_is_invalid_for_failed_verification() {
        let state = setup_state_from_verification(Err(
            "Last.fm error 10 for chart.gettopartists: Invalid API key".to_string()
        ));

        assert_eq!(state.status, LastfmSetupStatus::Invalid);
        assert!(
            state
                .message
                .as_deref()
                .is_some_and(|message| message.contains("Invalid API key"))
        );
    }
}
