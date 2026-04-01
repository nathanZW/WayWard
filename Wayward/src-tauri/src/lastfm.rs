use reqwest::Client;
use serde::Serialize;
use serde_json::Value;

const LASTFM_API_ROOT: &str = "https://ws.audioscrobbler.com/2.0/";

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

    let client = Client::builder()
        .user_agent("Wayward/0.1.0")
        .build()
        .map_err(|error| format!("Failed to create Last.fm client: {error}"))?;

    let mut first_error: Option<String> = None;

    let track_info = match fetch_method(
        &client,
        "track.getInfo",
        vec![
            ("artist".to_string(), trimmed_artist.to_string()),
            ("track".to_string(), trimmed_track.to_string()),
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
        &client,
        "track.getTopTags",
        vec![
            ("artist".to_string(), trimmed_artist.to_string()),
            ("track".to_string(), trimmed_track.to_string()),
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
        &client,
        "track.getSimilar",
        vec![
            ("artist".to_string(), trimmed_artist.to_string()),
            ("track".to_string(), trimmed_track.to_string()),
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
        &client,
        "artist.getTopAlbums",
        vec![
            ("artist".to_string(), trimmed_artist.to_string()),
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
        let current_album = normalize_name(&current_album);
        context
            .top_albums
            .retain(|album| normalize_name(&album.name) != current_album);
    }

    context.similar_tracks.truncate(6);
    context.top_albums.truncate(6);

    eprintln!(
        "[lastfm] lookup result artist='{trimmed_artist}' track='{trimmed_track}' tags={} similar_tracks={} top_albums={}",
        context.source.tags.len(),
        context.similar_tracks.len(),
        context.top_albums.len()
    );

    if context.source.tags.is_empty()
        && context.similar_tracks.is_empty()
        && context.top_albums.is_empty()
    {
        return Err(first_error.unwrap_or_else(|| {
            "Last.fm did not return any metadata for the current song.".to_string()
        }));
    }

    Ok(context)
}

async fn fetch_method(
    client: &Client,
    method: &str,
    params: Vec<(String, String)>,
) -> Result<Value, String> {
    let api_key = std::env::var("LASTFM_API_KEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "LASTFM_API_KEY is not set; Last.fm lookup is unavailable for {method}."
            )
        })?;

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
