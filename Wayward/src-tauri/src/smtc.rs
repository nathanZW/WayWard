use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use windows::Foundation::TimeSpan;
use windows::Storage::Streams::DataReader;
use windows::Media::Control::{GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager};
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

const VISIBLE_POLL_MS: u64 = 1000;
const HIDDEN_POLL_MS: u64 = 3_000;
const ALLOWED_SOURCE_KEYWORDS: [&str; 6] = [
    "applemusic",
    "amazonmusic",
    "spotify",
    "tidal",
    "deezer",
    "youtubemusic",
];

#[derive(serde::Serialize, Clone, Debug)]
pub struct TrackInfo {
    title: String,
    artist: String,
    album_artist: String,
    album_title: String,
    source_player: String,
    status: String,
    position: f64,
    duration: f64,
    album_art: Option<String>,
}

impl TrackInfo {
    fn neutral() -> Self {
        Self {
            title: String::new(),
            artist: String::new(),
            album_artist: String::new(),
            album_title: String::new(),
            source_player: String::new(),
            status: "Idle".to_string(),
            position: 0.0,
            duration: 0.0,
            album_art: None,
        }
    }

    fn is_neutral(&self) -> bool {
        self.title.trim().is_empty()
            && self.artist.trim().is_empty()
            && self.album_title.trim().is_empty()
            && self.album_art.is_none()
            && self.duration <= 0.0
    }
}

fn normalize_source_app_id(source_app_id: &str) -> String {
    source_app_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn is_allowed_source_app_id(source_app_id: &str) -> bool {
    let normalized = normalize_source_app_id(source_app_id);
    ALLOWED_SOURCE_KEYWORDS
        .iter()
        .any(|keyword| normalized.contains(keyword))
}

fn display_source_player(source_app_id: &str) -> Option<&'static str> {
    let normalized = normalize_source_app_id(source_app_id);

    if normalized.contains("applemusic") {
        Some("Apple Music")
    } else if normalized.contains("amazonmusic") {
        Some("Amazon Music")
    } else if normalized.contains("spotify") {
        Some("Spotify")
    } else if normalized.contains("tidal") {
        Some("TIDAL")
    } else if normalized.contains("deezer") {
        Some("Deezer")
    } else if normalized.contains("youtubemusic") {
        Some("YouTube Music")
    } else {
        None
    }
}

fn session_source_app_id(
    session: &GlobalSystemMediaTransportControlsSession,
) -> Option<String> {
    session.SourceAppUserModelId().ok().map(|id| id.to_string())
}

fn session_is_allowed(session: &GlobalSystemMediaTransportControlsSession) -> bool {
    session_source_app_id(session)
        .map(|source_id| is_allowed_source_app_id(&source_id))
        .unwrap_or(false)
}

fn session_source_player(session: &GlobalSystemMediaTransportControlsSession) -> String {
    session_source_app_id(session)
        .as_deref()
        .and_then(display_source_player)
        .unwrap_or_default()
        .to_string()
}

fn select_allowed_session(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> Option<GlobalSystemMediaTransportControlsSession> {
    if let Ok(current_session) = manager.GetCurrentSession() {
        if session_is_allowed(&current_session) {
            return Some(current_session);
        }
    }

    let sessions = manager.GetSessions().ok()?;
    let size = sessions.Size().ok()?;
    let mut fallback_session: Option<GlobalSystemMediaTransportControlsSession> = None;

    for index in 0..size {
        let session = match sessions.GetAt(index) {
            Ok(session) => session,
            Err(_) => continue,
        };

        if !session_is_allowed(&session) {
            continue;
        }

        if get_playback_status_str(&session) == "Playing" {
            return Some(session);
        }

        if fallback_session.is_none() {
            fallback_session = Some(session);
        }
    }

    fallback_session
}

pub async fn request_session_manager(
) -> Result<GlobalSystemMediaTransportControlsSessionManager, String> {
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("Failed to request manager: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to get manager: {:?}", e))
}

pub fn get_allowed_session(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> Result<GlobalSystemMediaTransportControlsSession, String> {
    select_allowed_session(manager).ok_or_else(|| {
        "No allowed media session found for Apple Music, Amazon Music, Spotify, TIDAL, Deezer, or YouTube Music."
            .to_string()
    })
}

fn get_playback_status_str(session: &GlobalSystemMediaTransportControlsSession) -> &'static str {
    match session.GetPlaybackInfo() {
        Ok(info) => match info.PlaybackStatus() {
            Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing) => "Playing",
            Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused) => "Paused",
            Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped) => "Stopped",
            _ => "Unknown",
        },
        Err(_) => "Unknown",
    }
}

fn get_timeline(session: &GlobalSystemMediaTransportControlsSession) -> (f64, f64) {
    match session.GetTimelineProperties() {
        Ok(timeline) => {
            let start_time: TimeSpan = timeline.StartTime().unwrap_or_default();
            let end_time: TimeSpan = timeline.EndTime().unwrap_or_default();
            let position_time: TimeSpan = timeline.Position().unwrap_or_default();

            let start_secs = start_time.Duration as f64 / 10_000_000.0;
            let end_secs = end_time.Duration as f64 / 10_000_000.0;
            let position_secs = position_time.Duration as f64 / 10_000_000.0;

            (position_secs.max(0.0), (end_secs - start_secs).max(0.0))
        }
        Err(_) => (0.0, 0.0),
    }
}

async fn get_album_art_base64(session: GlobalSystemMediaTransportControlsSession) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(async {
            let properties = session.TryGetMediaPropertiesAsync().ok()?.await.ok()?;

            let thumbnail_ref = properties.Thumbnail().ok()?;
            let stream = thumbnail_ref.OpenReadAsync().ok()?.await.ok()?;

            let size = stream.Size().ok()? as u32;
            if size == 0 {
                return None;
            }

            let reader = DataReader::CreateDataReader(&stream).ok()?;
            reader.LoadAsync(size).ok()?.await.ok()?;

            let mut buffer = vec![0u8; size as usize];
            reader.ReadBytes(&mut buffer).ok()?;

            let base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buffer);
            Some(format!("data:image/jpeg;base64,{}", base64))
        })
    }).await.ok()?
}

/// Called from toggle_playback / skip commands to immediately emit the new state.
/// This gives instant UI feedback without waiting for the next poll tick.
pub async fn emit_current_state(app: &AppHandle) {
    let manager = match request_session_manager().await {
        Ok(manager) => manager,
        Err(_) => return,
    };

    let session = match select_allowed_session(&manager) {
        Some(session) => session,
        None => {
            return;
        }
    };

    let status = get_playback_status_str(&session);
    let (position, duration) = get_timeline(&session);
    let source_player = session_source_player(&session);

    // Get media properties (title, artist, etc.) but skip album art for speed.
    // The poll loop will fill in album art on the next tick.
    if let Ok(properties_async) = session.TryGetMediaPropertiesAsync() {
        if let Ok(props) = properties_async.await {
            let info = TrackInfo {
                title: props.Title().unwrap_or_default().to_string(),
                artist: props.Artist().unwrap_or_default().to_string(),
                album_artist: props.AlbumArtist().unwrap_or_default().to_string(),
                album_title: props.AlbumTitle().unwrap_or_default().to_string(),
                source_player,
                status: status.to_string(),
                position,
                duration,
                album_art: None, // Skipped for speed; poll loop will fill this in.
            };

            if info.is_neutral() {
                return;
            }

            let _ = app.emit("smtc-update", info);
        }
    }
}

pub fn start_smtc_listener(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let manager = match request_session_manager().await {
            Ok(manager) => manager,
            Err(error) => {
                eprintln!("{error}");
                return;
            }
        };

        let app_handle = Arc::new(app);
        let mut cached_track_key: Option<String> = None;
        let mut cached_album_art: Option<String> = None;
        let mut had_session = false;
        let mut consecutive_session_misses = 0u8;

        loop {
            if let Some(session) = select_allowed_session(&manager) {
                consecutive_session_misses = 0;
                had_session = true;
                let status = get_playback_status_str(&session);
                let (position, duration) = get_timeline(&session);
                let source_player = session_source_player(&session);

                if let Ok(properties_async) = session.TryGetMediaPropertiesAsync() {
                    match properties_async.await {
                        Ok(props) => {
                            let title = props.Title().unwrap_or_default().to_string();
                            let artist = props.Artist().unwrap_or_default().to_string();
                            let album_artist = props.AlbumArtist().unwrap_or_default().to_string();
                            let album_title = props.AlbumTitle().unwrap_or_default().to_string();
                            let track_key =
                                format!("{}\u{1f}{}\u{1f}{}", title, artist, album_title);

                            // Only re-fetch album art on track change.
                            if cached_track_key.as_ref() != Some(&track_key) {
                                cached_album_art = get_album_art_base64(session.clone()).await;
                                cached_track_key = Some(track_key);
                            }

                            let info = TrackInfo {
                                title,
                                artist,
                                album_artist,
                                album_title,
                                source_player,
                                status: status.to_string(),
                                position,
                                duration,
                                album_art: cached_album_art.clone(),
                            };

                            if !info.is_neutral() {
                                let _ = app_handle.emit("smtc-update", info);
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to get media properties: {:?}", e);
                        }
                    }
                }
            } else if had_session {
                consecutive_session_misses = consecutive_session_misses.saturating_add(1);

                if consecutive_session_misses >= 2 {
                    had_session = false;
                    consecutive_session_misses = 0;
                    cached_track_key = None;
                    cached_album_art = None;
                    let _ = app_handle.emit("smtc-update", TrackInfo::neutral());
                }
            }
            let poll_ms = app_handle
                .get_webview_window("main")
                .and_then(|window| window.is_visible().ok())
                .map(|is_visible| if is_visible { VISIBLE_POLL_MS } else { HIDDEN_POLL_MS })
                .unwrap_or(VISIBLE_POLL_MS);

            // Poll faster while visible for smooth timeline updates, slower while hidden
            // to keep the overlay warm without doing unnecessary background work.
            tokio::time::sleep(std::time::Duration::from_millis(poll_ms)).await;
        }
    });
}
