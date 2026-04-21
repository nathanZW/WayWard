mod lastfm;
mod smtc;
use tauri::command;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use window_vibrancy::apply_acrylic;

fn interpret_smtc_command_result(action: &str, accepted: bool) -> Result<(), String> {
    if accepted {
        Ok(())
    } else {
        Err(format!(
            "The current media session did not accept the {action} command."
        ))
    }
}

async fn complete_smtc_command(
    app: &AppHandle,
    action: &str,
    accepted: bool,
) -> Result<(), String> {
    // Emit the latest state even when the player rejects the command so the UI stays truthful.
    smtc::emit_current_state(app).await;
    interpret_smtc_command_result(action, accepted)
}

#[command]
async fn toggle_playback(app: AppHandle) -> Result<(), String> {
    let manager = smtc::request_session_manager().await?;
    let session = smtc::get_allowed_session(&manager)?;

    let accepted = session
        .TryTogglePlayPauseAsync()
        .map_err(|e| format!("Failed to toggle: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to toggle (async): {:?}", e))?;

    complete_smtc_command(&app, "toggle playback", accepted).await
}

#[command]
async fn skip_next(app: AppHandle) -> Result<(), String> {
    let manager = smtc::request_session_manager().await?;
    let session = smtc::get_allowed_session(&manager)?;

    let accepted = session
        .TrySkipNextAsync()
        .map_err(|e| format!("Failed to skip next: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to skip next (async): {:?}", e))?;

    complete_smtc_command(&app, "skip next", accepted).await
}

#[command]
async fn skip_previous(app: AppHandle) -> Result<(), String> {
    let manager = smtc::request_session_manager().await?;
    let session = smtc::get_allowed_session(&manager)?;

    let accepted = session
        .TrySkipPreviousAsync()
        .map_err(|e| format!("Failed to skip previous: {:?}", e))?
        .await
        .map_err(|e| format!("Failed to skip previous (async): {:?}", e))?;

    complete_smtc_command(&app, "skip previous", accepted).await
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let alt_w = Shortcut::new(Some(Modifiers::ALT), Code::KeyW);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &alt_w && event.state() == ShortcutState::Pressed {
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
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            lastfm::load_local_env();

            if let Err(e) = app.global_shortcut().register(alt_w) {
                eprintln!("Failed to register global shortcut: {:?}", e);
            }

            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "windows")]
            let _ = apply_acrylic(&window, Some((18, 18, 20, 130)));

            smtc::start_smtc_listener(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            toggle_playback,
            skip_next,
            skip_previous,
            lastfm::get_lastfm_setup_state,
            lastfm::submit_lastfm_api_key,
            lastfm::lookup_lastfm_context
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::interpret_smtc_command_result;

    #[test]
    fn smtc_command_result_accepts_true_outcomes() {
        let result = interpret_smtc_command_result("toggle playback", true);

        assert!(result.is_ok());
    }

    #[test]
    fn smtc_command_result_rejects_false_outcomes() {
        let result = interpret_smtc_command_result("skip next", false);

        assert_eq!(
            result.expect_err("expected rejected command to surface an error"),
            "The current media session did not accept the skip next command."
        );
    }
}
