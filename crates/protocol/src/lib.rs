use cybervps_shared_types::{MachineCapabilities, PortObservation, ProcessObservation};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "1.0.0";

/// Messages sent from the Agent to the Relay / Control Plane
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum AgentMessage {
    Auth {
        machine_id: String,
        token: String,
        agent_version: String,
        hostname: String,
        os: String,
        os_version: String,
        arch: String,
        capabilities: MachineCapabilities,
    },
    Heartbeat {
        machine_id: String,
        timestamp: u64,
        uptime_seconds: u64,
        cpu_usage: f32,
        memory_used_bytes: u64,
        memory_total_bytes: u64,
        disk_used_bytes: u64,
        disk_total_bytes: u64,
    },
    DiscoveryReport {
        machine_id: String,
        ports: Vec<PortObservation>,
        processes: Vec<ProcessObservation>,
    },
    TerminalOutput {
        session_id: String,
        data: String,
    },
    TerminalClosed {
        session_id: String,
        exit_code: Option<i32>,
    },
    TunnelStreamOpened {
        tunnel_id: String,
        stream_id: String,
        success: bool,
        error: Option<String>,
    },
    TunnelData {
        tunnel_id: String,
        stream_id: String,
        data_base64: String,
    },
    TunnelStreamClosed {
        tunnel_id: String,
        stream_id: String,
    },
    DiagnosticReport {
        machine_id: String,
        capabilities: MachineCapabilities,
        diagnostics_log: Vec<String>,
    },
}

/// Messages sent from the Relay / Control Plane to the Agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerMessage {
    AuthAck {
        machine_id: String,
        success: bool,
        error: Option<String>,
        heartbeat_interval_secs: u32,
    },
    HeartbeatAck {
        server_timestamp: u64,
    },
    TriggerDiscovery,
    TerminalStart {
        session_id: String,
        cols: u16,
        rows: u16,
        shell_preference: Option<String>,
    },
    TerminalInput {
        session_id: String,
        data: String,
    },
    TerminalResize {
        session_id: String,
        cols: u16,
        rows: u16,
    },
    TerminalKill {
        session_id: String,
    },
    TunnelOpenStream {
        tunnel_id: String,
        stream_id: String,
        target_port: u16,
    },
    TunnelData {
        tunnel_id: String,
        stream_id: String,
        data_base64: String,
    },
    TunnelCloseStream {
        tunnel_id: String,
        stream_id: String,
    },
}

#[derive(thiserror::Error, Debug)]
pub enum ProtocolError {
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Base64 error: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("Invalid message format: {0}")]
    InvalidFormat(String),
}

impl AgentMessage {
    pub fn to_json(&self) -> Result<String, ProtocolError> {
        Ok(serde_json::to_string(self)?)
    }

    pub fn from_json(json: &str) -> Result<Self, ProtocolError> {
        Ok(serde_json::from_str(json)?)
    }
}

impl ServerMessage {
    pub fn to_json(&self) -> Result<String, ProtocolError> {
        Ok(serde_json::to_string(self)?)
    }

    pub fn from_json(json: &str) -> Result<Self, ProtocolError> {
        Ok(serde_json::from_str(json)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protocol_serde() {
        let msg = ServerMessage::TriggerDiscovery;
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        matches!(parsed, ServerMessage::TriggerDiscovery);
    }
}
