#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      #[cfg(desktop)]
      {
        use tauri::Manager;
        use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

        app.handle().plugin(
          tauri_plugin_global_shortcut::Builder::new()
            .with_shortcuts(["ctrl+space"])?
            .with_handler(|app, shortcut, event| {
              if event.state == ShortcutState::Pressed && shortcut.matches(Modifiers::CONTROL, Code::Space) {
                if let Some(window) = app.get_webview_window("main") {
                  let _ = window.show();
                  let _ = window.set_focus();
                }
              }
            })
            .build(),
        )?;
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running Oracle Amigo Quick Voice");
}
