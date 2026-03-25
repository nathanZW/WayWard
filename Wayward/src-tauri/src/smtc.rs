use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use windows::Foundation::TimeSpan;
use windows::Storage::Streams::DataReader;
use windows::Media::Control::{GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager};
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

#[derive(serde::Serialize, Clone)]
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

async fn get_album_art_base64(session: GlobalSystemMediaTransportControlsSession) -> Option<String> {
    // Use spawn_blocking to handle non-Send Windows COM interfaces
    tauri::async_runtime::spawn_blocking(move || {
        // Use tauri async runtime to block on async operations
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

pub fn start_smtc_listener(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let manager_result = GlobalSystemMediaTransportControlsSessionManager::RequestAsync();

        let manager = match manager_result {
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

        loop {
            if let Ok(session) = manager.GetCurrentSession() {
                let status = match session.GetPlaybackInfo() {
                    Ok(info) => match info.PlaybackStatus() {
                        Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing) => "Playing",
                        Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused) => "Paused",
                        Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped) => "Stopped",
                        _ => "Unknown",
                    },
                    Err(_) => "Unknown",
                };

                let (position, duration) = match session.GetTimelineProperties() {
                    Ok(timeline) => {
                        let start_time: TimeSpan = timeline.StartTime().unwrap_or_default();
                        let end_time: TimeSpan = timeline.EndTime().unwrap_or_default();
                        let position_time: TimeSpan = timeline.Position().unwrap_or_default();

                        let start_secs = start_time.Duration as f64 / 10_000_000.0;
                        let end_secs = end_time.Duration as f64 / 10_000_000.0;
                        let position_secs = position_time.Duration as f64 / 10_000_000.0;

                        let duration = (end_secs - start_secs).max(0.0);
                        let position = position_secs.max(0.0);

                        (position, duration)
                    }
                    Err(e) => {
                        eprintln!("Failed to get timeline properties: {:?}", e);
                        (0.0, 0.0)
                    }
                };

                let album_art = get_album_art_base64(session.clone()).await;

                if let Ok(properties_async) = session.TryGetMediaPropertiesAsync() {
                    match properties_async.await {
                        Ok(props) => {
                            let info = TrackInfo {
                                title: props.Title().unwrap_or_default().to_string(),
                                artist: props.Artist().unwrap_or_default().to_string(),
                                album_artist: props.AlbumArtist().unwrap_or_default().to_string(),
                                album_title: props.AlbumTitle().unwrap_or_default().to_string(),
                                status: status.to_string(),
                                position,
                                duration,
                                album_art,
                            };

                            let _ = app_handle.emit("smtc-update", info);
                        }
                        Err(e) => {
                             eprintln!("Failed to get media properties: {:?}", e);
                        }
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    });
}
