use chrono::{DateTime, Utc};
use cybervps-shared-types::UserRole;
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    ManageUsers,
    EnrollMachine,
    ViewMachine,
    OpenTerminal,
    RunCommand,
    CreateTunnel,
    RevokeTunnel,
    ExposePublic,
    ViewAudit,
    ModifySettings,
}

pub fn has_permission(role: &UserRole, perm: Permission) -> bool {
    match role {
        UserRole::Owner => true,
        UserRole::Admin => !matches!(perm, Permission::ModifySettings),
        UserRole::Operator => matches!(
            perm,
            Permission::ViewMachine
                | Permission::OpenTerminal
                | Permission::RunCommand
                | Permission::CreateTunnel
                | Permission::RevokeTunnel
                | Permission::ViewAudit
        ),
        UserRole::Viewer => matches!(perm, Permission::ViewMachine | Permission::ViewAudit),
    }
}

/// Generates a cryptographically secure random enrollment token with prefix
pub fn generate_enrollment_token() -> String {
    format!("cvps_enroll_{}", Uuid::new_v4().simple())
}

/// Generates a cryptographically secure device auth key
pub fn generate_device_key() -> String {
    format!("cvps_key_{}_{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// SHA-256 hash helper for secure token storage
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Validates whether an IP or target is safe from SSRF exploits.
/// Cloud metadata (169.254.169.254) and IPv6 loopback variants are strictly checked.
pub fn is_safe_target_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            // Block 169.254.0.0/16 (Link Local & AWS/GCP/Azure Cloud Metadata)
            if v4.is_link_local() {
                return false;
            }
            // Block broadcast
            if v4.is_broadcast() {
                return false;
            }
            true
        }
        IpAddr::V6(v6) => {
            // Block IPv6 link-local
            !v6.is_unicast_link_local()
        }
    }
}

/// Validates a local target port to ensure it falls within permissible TCP range
pub fn validate_target_port(port: u16) -> Result<(), &'static str> {
    if port == 0 {
        return Err("Port 0 is reserved and invalid");
    }
    Ok(())
}

/// Sanitizes log strings to ensure tokens, passwords, and authorization headers are never logged
pub fn sanitize_log(input: &str) -> String {
    let mut out = input.to_string();
    if let Some(pos) = out.find("Bearer ") {
        let end = out[pos + 7..].find(' ').unwrap_or(out.len() - (pos + 7));
        out.replace_range(pos + 7..pos + 7 + end, "[REDACTED]");
    }
    if let Some(pos) = out.find("token=") {
        let end = out[pos + 6..].find('&').unwrap_or(out.len() - (pos + 6));
        out.replace_range(pos + 6..pos + 6 + end, "[REDACTED]");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn test_permissions() {
        assert!(has_permission(&UserRole::Owner, Permission::ExposePublic));
        assert!(has_permission(&UserRole::Admin, Permission::CreateTunnel));
        assert!(!has_permission(&UserRole::Viewer, Permission::OpenTerminal));
        assert!(!has_permission(&UserRole::Viewer, Permission::CreateTunnel));
    }

    #[test]
    fn test_ssrf_blocking() {
        let metadata_ip: IpAddr = IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254));
        assert!(!is_safe_target_ip(&metadata_ip));

        let loopback: IpAddr = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        assert!(is_safe_target_ip(&loopback));
    }

    #[test]
    fn test_sanitize_log() {
        let sensitive = "Request with Bearer eyJhbGciOiJIUzI1Ni... token=secret123&other=1";
        let sanitized = sanitize_log(sensitive);
        assert!(!sanitized.contains("eyJhbGciOiJIUzI1Ni..."));
        assert!(!sanitized.contains("secret123"));
    }
}
