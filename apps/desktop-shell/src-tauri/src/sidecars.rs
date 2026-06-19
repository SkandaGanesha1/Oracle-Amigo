use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
pub enum SidecarKind {
  LocalAgent,
  NotificationBridge,
  QuickVoice,
}

#[derive(Debug, Clone, Serialize)]
pub struct SidecarStatus {
  pub name: &'static str,
  pub kind: SidecarKind,
  pub configured: bool,
  pub running: bool,
  pub detail: &'static str,
}

pub fn sidecar_statuses() -> Vec<SidecarStatus> {
  vec![
    SidecarStatus {
      name: "local-agent",
      kind: SidecarKind::LocalAgent,
      configured: true,
      running: false,
      detail: "placeholder: dev launch is allowlisted as dev-local-agent",
    },
    SidecarStatus {
      name: "notification-bridge",
      kind: SidecarKind::NotificationBridge,
      configured: true,
      running: false,
      detail: "placeholder: dev launch is allowlisted as dev-notification-bridge",
    },
    SidecarStatus {
      name: "quick-voice",
      kind: SidecarKind::QuickVoice,
      configured: true,
      running: false,
      detail: "placeholder: dev launch is allowlisted as dev-quick-voice",
    },
  ]
}

#[tauri::command]
pub fn list_sidecars() -> Vec<SidecarStatus> {
  sidecar_statuses()
}

#[tauri::command]
pub fn restart_local_agent_placeholder() -> SidecarStatus {
  SidecarStatus {
    name: "local-agent",
    kind: SidecarKind::LocalAgent,
    configured: true,
    running: false,
    detail: "restart placeholder only; production process supervision is not implemented",
  }
}
