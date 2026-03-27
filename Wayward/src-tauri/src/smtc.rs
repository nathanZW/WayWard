use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use windows::Foundation::TimeSpan;
use windows::Storage::Streams::DataReader;
use windows::Media::Control::{GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager};
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

#[derive(serde::Serialize, Clone, Debug)]
pub struct TrackInfo {
    title: String,
    artist: String,
    album_artist: String,
    album_title: String,
    status: String,
    position: f64,
    duration: f64,
    album_art: Option<String>,
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
    let manager = match GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
        Ok(m) => match m.await {
            Ok(mgr) => mgr,
            Err(_) => return,
        },
        Err(_) => return,
    };

    let session = match manager.GetCurrentSession() {
        Ok(s) => s,
        Err(_) => return,
    };

    let status = get_playback_status_str(&session);
    let (position, duration) = get_timeline(&session);

    // Get media properties (title, artist, etc.) but skip album art for speed.
    // The poll loop will fill in album art on the next tick.
    if let Ok(properties_async) = session.TryGetMediaPropertiesAsync() {
        if let Ok(props) = properties_async.await {
            let info = TrackInfo {
                title: props.Title().unwrap_or_default().to_string(),
                artist: props.Artist().unwrap_or_default().to_string(),
                album_artist: props.AlbumArtist().unwrap_or_default().to_string(),
                album_title: props.AlbumTitle().unwrap_or_default().to_string(),
                status: status.to_string(),
                position,
                duration,
                album_art: None, // Skipped for speed; poll loop will fill this in.
            };
            let _ = app.emit("smtc-update", info);
        }
    }
}

pub fn start_smtc_listener(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let manager = match GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
            Ok(m) => match m.await {
                Ok(mgr) => mgr,
                Err(e) => {
                    eprintln!("Failed to get session manager: {:?}", e);
                    return;
                }
            },
            Err(e) => {
                eprintln!("Failed to request session manager: {:?}", e);
                return;
            }
        };

        let app_handle = Arc::new(app);
        let mut cached_title = String::new();
        let mut cached_album_art: Option<String> = None;

        loop {
            if let Ok(session) = manager.GetCurrentSession() {
                let status = get_playback_status_str(&session);
                let (position, duration) = get_timeline(&session);

                if let Ok(properties_async) = session.TryGetMediaPropertiesAsync() {
                    match properties_async.await {
                        Ok(props) => {
                            let title = props.Title().unwrap_or_default().to_string();

                            // Only re-fetch album art on track change.
                            if title != cached_title {
                                cached_album_art = get_album_art_base64(session.clone()).await;
                                cached_title = title.clone();
                            }

                            let info = TrackInfo {
                                title,
                                artist: props.Artist().unwrap_or_default().to_string(),
                                album_artist: props.AlbumArtist().unwrap_or_default().to_string(),
                                album_title: props.AlbumTitle().unwrap_or_default().to_string(),
                                status: status.to_string(),
                                position,
                                duration,
                                album_art: cached_album_art.clone(),
                            };

                            let _ = app_handle.emit("smtc-update", info);
                        }
                        Err(e) => {
                            eprintln!("Failed to get media properties: {:?}", e);
                        }
                    }
                }
            }
            // Poll at 500ms for steady position updates.
            // Instant status updates come from emit_current_state() called by commands.
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    });
}
