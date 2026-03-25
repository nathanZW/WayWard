mod smtc;
use tauri::Manager;
use tauri::command;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use window_vibrancy::apply_acrylic;

#[command]
async fn toggle_playback() -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("Failed to request manager: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to get manager: {:?}", e))?;

    let session = manager.GetCurrentSession()
        .map_err(|e| format!("Failed to get current session: {:?}", e))?;

    let playback_info = session.GetPlaybackInfo()
        .map_err(|e| format!("Failed to get playback info: {:?}", e))?;

    let status = playback_info.PlaybackStatus()
        .map_err(|e| format!("Failed to get playback status: {:?}", e))?;

    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;
    
    match status {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => {
            session.TryPauseAsync()
                .map_err(|e| format!("Failed to pause: {:?}", e))?
                .await
                .map_err(|e| format!("Failed to pause (async): {:?}", e))?;
        }
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused |
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => {
            session.TryPlayAsync()
                .map_err(|e| format!("Failed to play: {:?}", e))?
                .await
                .map_err(|e| format!("Failed to play (async): {:?}", e))?;
        }
        _ => return Err("Unknown playback status".to_string()),
    }

    Ok(())
}

#[command]
async fn skip_next() -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("Failed to request manager: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to get manager: {:?}", e))?;

    let session = manager.GetCurrentSession()
        .map_err(|e| format!("Failed to get current session: {:?}", e))?;

    session.TrySkipNextAsync()
        .map_err(|e| format!("Failed to skip next: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to skip next (async): {:?}", e))?;

    Ok(())
}

#[command]
async fn skip_previous() -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("Failed to request manager: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to get manager: {:?}", e))?;

    let session = manager.GetCurrentSession()
        .map_err(|e| format!("Failed to get current session: {:?}", e))?;

    session.TrySkipPreviousAsync()
        .map_err(|e| format!("Failed to skip previous: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to skip previous (async): {:?}", e))?;

    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ctrl_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &ctrl_space && event.state() == ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        let is_visible = window.is_visible().unwrap_or(false);
                        if is_visible {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            })
            .build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            if let Err(e) = app.global_shortcut().register(ctrl_space) {
                eprintln!("Failed to register global shortcut: {:?}", e);
            }

            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "windows")]
            let _ = apply_acrylic(&window, Some((18, 18, 20, 230)));

            smtc::start_smtc_listener(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, toggle_playback, skip_next, skip_previous])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
