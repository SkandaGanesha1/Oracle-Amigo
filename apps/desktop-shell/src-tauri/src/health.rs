use std::time::Duration;

use serde::Serialize;

pub const DEFAULT_AGENT_PORT: u16 = 3399;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AgentHealth {
  pub status: String,
  pub port: u16,
  pub url: String,
  pub message: Option<String>,
}

pub fn configured_agent_port() -> u16 {
  std::env::var("AGENTIC_AGENT_PORT")
    .ok()
    .or_else(|| std::env::var("SANDBOX_PORT").ok())
    .and_then(|value| value.parse::<u16>().ok())
    .unwrap_or(DEFAULT_AGENT_PORT)
}

pub fn check_agent_health(port: u16) -> AgentHealth {
  let url = format!("http://127.0.0.1:{port}/health");
  match ureq::get(&url).timeout(Duration::from_millis(800)).call() {
    Ok(response) if response.status() == 200 => AgentHealth {
      status: "ok".to_string(),
      port,
      url,
      message: None,
    },
    Ok(response) => AgentHealth {
      status: "down".to_string(),
      port,
      url,
      message: Some(format!("health endpoint returned HTTP {}", response.status())),
    },
    Err(error) => AgentHealth {
      status: "unreachable".to_string(),
      port,
      url,
      message: Some(error.to_string()),
    },
  }
}

#[tauri::command]
pub fn agent_health() -> AgentHealth {
  check_agent_health(configured_agent_port())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn health_check_fails_gracefully_when_agent_is_absent() {
    let health = check_agent_health(9);

    assert_eq!(health.status, "unreachable");
    assert_eq!(health.port, 9);
    assert_eq!(health.url, "http://127.0.0.1:9/health");
    assert!(health.message.is_some());
  }

  #[test]
  fn invalid_env_port_uses_default() {
    std::env::set_var("AGENTIC_AGENT_PORT", "not-a-port");
    std::env::remove_var("SANDBOX_PORT");

    assert_eq!(configured_agent_port(), DEFAULT_AGENT_PORT);

    std::env::remove_var("AGENTIC_AGENT_PORT");
  }
}
