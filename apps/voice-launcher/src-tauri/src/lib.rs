#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![show_voice_window])
    .setup(|app| {
      #[cfg(desktop)]
      {
        use tauri::Emitter;
        use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

        app.handle().plugin(
          tauri_plugin_global_shortcut::Builder::new()
            .with_shortcuts(["ctrl+space"])?
            .with_handler(|app, shortcut, event| {
              if event.state == ShortcutState::Pressed && shortcut.matches(Modifiers::CONTROL, Code::Space) {
                let _ = show_voice_window(app.clone());
                let _ = app.emit("voice:start", ());
              }
              if event.state == ShortcutState::Released && shortcut.matches(Modifiers::CONTROL, Code::Space) {
                let _ = app.emit("voice:stop-and-submit", ());
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

#[tauri::command]
fn show_voice_window(app: tauri::AppHandle) -> Result<(), String> {
  use tauri::{Manager, PhysicalPosition, PhysicalSize, Position, Size};

  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "voice launcher window not found".to_string())?;
  let width = 420_u32;
  let height = 180_u32;
  let margin_right = 24_i32;
  let margin_bottom = 24_i32;
  let taskbar_fallback = 72_i32;

  let monitor = window
    .primary_monitor()
    .map_err(|err| err.to_string())?
    .or_else(|| window.current_monitor().ok().flatten())
    .ok_or_else(|| "no monitor found".to_string())?;
  let monitor_position = monitor.position();
  let monitor_size = monitor.size();
  let x = monitor_position.x + monitor_size.width as i32 - width as i32 - margin_right;
  let y = monitor_position.y + monitor_size.height as i32 - height as i32 - margin_bottom - taskbar_fallback;

  window
    .set_size(Size::Physical(PhysicalSize { width, height }))
    .map_err(|err| err.to_string())?;
  window
    .set_position(Position::Physical(PhysicalPosition { x, y }))
    .map_err(|err| err.to_string())?;
  window.show().map_err(|err| err.to_string())?;
  window.set_focus().map_err(|err| err.to_string())?;
  Ok(())
}
