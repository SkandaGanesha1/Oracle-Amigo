mod health;
mod sidecars;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub use health::{agent_health, check_agent_health, configured_agent_port};
pub use sidecars::{list_sidecars, restart_local_agent_placeholder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      agent_health,
      list_sidecars,
      restart_local_agent_placeholder,
      open_main_window,
    ])
    .setup(|app| {
      #[cfg(desktop)]
      setup_tray(app.handle())?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running Oracle Amigo desktop shell");
}

#[tauri::command]
fn open_main_window(app: AppHandle) -> Result<(), String> {
  show_main_window(&app)
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main window not found".to_string())?;
  window.show().map_err(|err| err.to_string())?;
  window.set_focus().map_err(|err| err.to_string())?;
  Ok(())
}

#[cfg(desktop)]
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
  let open = MenuItem::with_id(app, "open", "Open Oracle Amigo", true, None::<&str>)?;
  let status = MenuItem::with_id(app, "agent-status", "Agent status", true, None::<&str>)?;
  let restart = MenuItem::with_id(app, "restart-agent", "Restart local agent", true, None::<&str>)?;
  let logs = MenuItem::with_id(app, "open-logs", "Open logs", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&open, &status, &restart, &logs, &quit])?;

  let mut builder = TrayIconBuilder::with_id("main")
    .tooltip("Oracle Amigo")
    .menu(&menu)
    .show_menu_on_left_click(true)
    .on_menu_event(|app, event| match event.id().as_ref() {
      "open" => {
        let _ = show_main_window(app);
      }
      "agent-status" => {
        let health = health::check_agent_health(health::configured_agent_port());
        println!("[desktop-shell] agent status: {} {}", health.status, health.url);
      }
      "restart-agent" => {
        let status = sidecars::restart_local_agent_placeholder();
        println!("[desktop-shell] {}", status.detail);
      }
      "open-logs" => {
        println!("[desktop-shell] open logs placeholder: %LOCALAPPDATA%/OracleAmigo/profiles/default/logs/");
      }
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        let _ = show_main_window(&tray.app_handle());
      }
    });

  if let Some(icon) = app.default_window_icon() {
    builder = builder.icon(icon.clone());
  }

  builder.build(app)?;
  Ok(())
}
