mod smtc;
use tauri::{AppHandle, Emitter, Manager};
use tauri::command;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use window_vibrancy::apply_acrylic;

#[command]
async fn toggle_playback(app: AppHandle) -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("Failed to request manager: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to get manager: {:?}", e))?;

    let session = manager.GetCurrentSession()
        .map_err(|e| format!("Failed to get current session: {:?}", e))?;

    session.TryTogglePlayPauseAsync()
        .map_err(|e| format!("Failed to toggle: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to toggle (async): {:?}", e))?;

    // Immediately emit the new state so the UI updates without waiting for the poll.
    smtc::emit_current_state(&app).await;

    Ok(())
}

#[command]
async fn skip_next(app: AppHandle) -> Result<(), String> {
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

    smtc::emit_current_state(&app).await;

    Ok(())
}

#[command]
async fn skip_previous(app: AppHandle) -> Result<(), String> {
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

    smtc::emit_current_state(&app).await;

    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ctrl_space = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &ctrl_space && event.state() == ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        let is_visible = window.is_visible().unwrap_or(false);
                        if is_visible {
                            let _ = window.hide();
                            let _ = app.emit("window-visibility", false);
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit("window-visibility", true);
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                smtc::emit_current_state(&app_handle).await;
                            });
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
            let _ = apply_acrylic(&window, Some((18, 18, 20, 180)));

            smtc::start_smtc_listener(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, toggle_playback, skip_next, skip_previous])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
