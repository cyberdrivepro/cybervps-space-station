use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlPlaneConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub secret_key: String,
    pub base_domain: String,
    pub public_url: String,
}

impl Default for ControlPlaneConfig {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 8080,
            database_url: "postgres://cybervps:cybervps@localhost:5432/cybervps".to_string(),
            secret_key: "change-this-production-secret-station-key".to_string(),
            base_domain: "space.cybervps.local".to_string(),
            public_url: "http://localhost:8080".to_string(),
        }
    }
}

impl ControlPlaneConfig {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        Self {
            host: env::var("CYBERVPS_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("CYBERVPS_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8080),
            database_url: env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://cybervps:cybervps@localhost:5432/cybervps".to_string()
            }),
            secret_key: env::var("CYBERVPS_SECRET_KEY")
                .unwrap_or_else(|_| "space-station-default-secret-change-in-prod".to_string()),
            base_domain: env::var("CYBERVPS_BASE_DOMAIN")
                .unwrap_or_else(|_| "localhost".to_string()),
            public_url: env::var("CYBERVPS_PUBLIC_URL")
                .unwrap_or_else(|_| "http://localhost:8080".to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub server_url: String,
    pub enrollment_token: Option<String>,
    pub device_key: Option<String>,
    pub machine_id: Option<String>,
    pub heartbeat_interval_secs: u64,
    pub port_scan_interval_secs: u64,
    pub max_reconnect_backoff_secs: u64,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            server_url: "ws://localhost:8080/api/v1/relay/connect".to_string(),
            enrollment_token: None,
            device_key: None,
            machine_id: None,
            heartbeat_interval_secs: 15,
            port_scan_interval_secs: 30,
            max_reconnect_backoff_secs: 60,
        }
    }
}

impl AgentConfig {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        Self {
            server_url: env::var("CYBERVPS_SERVER_URL")
                .unwrap_or_else(|_| "ws://localhost:8080/api/v1/relay/connect".to_string()),
            enrollment_token: env::var("CYBERVPS_ENROLLMENT_TOKEN").ok(),
            device_key: env::var("CYBERVPS_DEVICE_KEY").ok(),
            machine_id: env::var("CYBERVPS_MACHINE_ID").ok(),
            heartbeat_interval_secs: env::var("CYBERVPS_HEARTBEAT_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(15),
            port_scan_interval_secs: env::var("CYBERVPS_SCAN_INTERVAL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
            max_reconnect_backoff_secs: env::var("CYBERVPS_MAX_BACKOFF_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60),
        }
    }
}
