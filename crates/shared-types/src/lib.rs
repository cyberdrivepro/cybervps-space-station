use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MachineStatus {
    Online,
    Offline,
    Reconnecting,
    Unauthorized,
    Limited,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineInfo {
    pub id: String,
    pub hostname: String,
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub agent_version: String,
    pub status: MachineStatus,
    pub last_seen: DateTime<Utc>,
    pub uptime_seconds: u64,
    pub cpu_usage: f32,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub capabilities: MachineCapabilities,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MachineCapabilities {
    pub is_root: bool,
    pub has_systemd: bool,
    pub writable_fs: bool,
    pub pty_supported: bool,
    pub outbound_dns: bool,
    pub outbound_tls: bool,
    pub process_inspection: bool,
    pub shell: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Protocol {
    Tcp,
    Udp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortObservation {
    pub port: u16,
    pub protocol: Protocol,
    pub bind_address: String,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub is_http: bool,
    pub http_status: Option<u16>,
    pub http_title: Option<String>,
    pub has_websocket: bool,
    pub last_discovered: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessObservation {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory_bytes: u64,
    pub user: Option<String>,
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccessMode {
    Private,
    Protected,
    Public,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TunnelStatus {
    Creating,
    Active,
    Degraded,
    AgentDisconnected,
    Revoked,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelConfig {
    pub id: String,
    pub machine_id: String,
    pub target_port: u16,
    pub public_subdomain: String,
    pub public_url: String,
    pub access_mode: AccessMode,
    pub access_token: Option<String>,
    pub status: TunnelStatus,
    pub created_at: DateTime<Utc>,
    pub request_count: u64,
    pub bytes_transferred: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSessionMeta {
    pub id: String,
    pub machine_id: String,
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
    pub created_at: DateTime<Utc>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Owner,
    Admin,
    Operator,
    Viewer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub event_type: String,
    pub machine_id: Option<String>,
    pub actor: String,
    pub details: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollmentTokenData {
    pub token: String,
    pub org_id: String,
    pub expires_at: DateTime<Utc>,
    pub max_uses: u32,
    pub used_count: u32,
    pub is_revoked: bool,
}
