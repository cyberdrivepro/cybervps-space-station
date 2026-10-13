use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum NetworkError {
    #[error("Port 0 is reserved and cannot be used as a destination endpoint")]
    InvalidPortZero,
    #[error("Port number out of range: {0}")]
    PortOutOfRange(u32),
    #[error("Invalid port range expression: {0}")]
    InvalidRange(String),
    #[error("Range exceeds maximum batch allocation limit ({0} ports)")]
    RangeTooLarge(usize),
    #[error("IP address exhaustion in virtual network CIDR")]
    IpExhaustion,
}

/// Validates that a port number falls within the active, assignable range (1..=65535)
pub fn validate_port(port: u16) -> Result<(), NetworkError> {
    if port == 0 {
        return Err(NetworkError::InvalidPortZero);
    }
    Ok(())
}

/// Parses individual ports, comma-separated lists, and inclusive ranges
/// Example: "80,443,8000-8005"
pub fn parse_port_specification(spec: &str, max_ports: usize) -> Result<Vec<u16>, NetworkError> {
    let mut ports = HashSet::new();

    for token in spec.split(',') {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }

        if token.contains('-') {
            let parts: Vec<&str> = token.split('-').collect();
            if parts.len() != 2 {
                return Err(NetworkError::InvalidRange(token.to_string()));
            }
            let start = parts[0].trim().parse::<u32>().map_err(|_| NetworkError::InvalidRange(token.to_string()))?;
            let end = parts[1].trim().parse::<u32>().map_err(|_| NetworkError::InvalidRange(token.to_string()))?;

            if start == 0 || end == 0 || start > 65535 || end > 65535 || start > end {
                return Err(NetworkError::InvalidRange(token.to_string()));
            }

            for p in start..=end {
                ports.insert(p as u16);
                if ports.len() > max_ports {
                    return Err(NetworkError::RangeTooLarge(max_ports));
                }
            }
        } else {
            let p = token.parse::<u32>().map_err(|_| NetworkError::InvalidRange(token.to_string()))?;
            if p == 0 || p > 65535 {
                return Err(NetworkError::PortOutOfRange(p));
            }
            ports.insert(p as u16);
            if ports.len() > max_ports {
                return Err(NetworkError::RangeTooLarge(max_ports));
            }
        }
    }

    let mut result: Vec<u16> = ports.into_iter().collect();
    result.sort();
    Ok(result)
}

/// Tests if a local port can be bound. If occupied, safely queries the OS for an available port.
pub fn resolve_available_local_port(preferred: u16) -> (u16, bool) {
    if preferred > 0 {
        let addr = SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), preferred);
        if let Ok(listener) = TcpListener::bind(addr) {
            drop(listener);
            return (preferred, false); // No conflict, preferred port is available
        }
    }

    // Bind port 0 to let OS assign an available ephemeral port
    let addr = SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 0);
    if let Ok(listener) = TcpListener::bind(addr) {
        if let Ok(local_addr) = listener.local_addr() {
            drop(listener);
            return (local_addr.port(), true); // Conflict resolved with new port
        }
    }

    // Fallback: search iteratively
    for test_port in 17000..=65535 {
        let addr = SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), test_port);
        if let Ok(listener) = TcpListener::bind(addr) {
            drop(listener);
            return (test_port, true);
        }
    }

    (preferred, false)
}

/// Manages Virtual IP allocations for Mode B (e.g. 10.77.0.0/24)
pub struct VirtualIpPool {
    base_octets: [u8; 3],
    allocated: HashMap<String, Ipv4Addr>, // machine_id -> virtual_ip
    used_hosts: HashSet<u8>,
}

impl VirtualIpPool {
    pub fn new(first: u8, second: u8, third: u8) -> Self {
        let mut used = HashSet::new();
        used.insert(0); // Network
        used.insert(1); // Gateway / Control Plane (10.77.0.1)
        used.insert(255); // Broadcast
        Self {
            base_octets: [first, second, third],
            allocated: HashMap::new(),
            used_hosts: used,
        }
    }

    pub fn allocate_ip(&mut self, machine_id: &str) -> Result<Ipv4Addr, NetworkError> {
        if let Some(existing) = self.allocated.get(machine_id) {
            return Ok(*existing);
        }

        for host in 2..255 {
            if !self.used_hosts.contains(&host) {
                self.used_hosts.insert(host);
                let ip = Ipv4Addr::new(
                    self.base_octets[0],
                    self.base_octets[1],
                    self.base_octets[2],
                    host,
                );
                self.allocated.insert(machine_id.to_string(), ip);
                return Ok(ip);
            }
        }

        Err(NetworkError::IpExhaustion)
    }

    pub fn release_ip(&mut self, machine_id: &str) {
        if let Some(ip) = self.allocated.remove(machine_id) {
            let octets = ip.octets();
            self.used_hosts.remove(&octets[3]);
        }
    }

    pub fn get_ip(&self, machine_id: &str) -> Option<Ipv4Addr> {
        self.allocated.get(machine_id).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_port_validation() {
        assert!(validate_port(0).is_err());
        assert!(validate_port(1).is_ok());
        assert!(validate_port(65535).is_ok());
    }

    #[test]
    fn test_port_spec_parsing() {
        let ports = parse_port_specification("22, 80, 8000-8003", 50).unwrap();
        assert_eq!(ports, vec![22, 80, 8000, 8001, 8002, 8003]);
    }

    #[test]
    fn test_virtual_ip_allocation() {
        let mut pool = VirtualIpPool::new(10, 77, 0);
        let ip1 = pool.allocate_ip("vps-1").unwrap();
        let ip2 = pool.allocate_ip("vps-2").unwrap();
        assert_eq!(ip1, Ipv4Addr::new(10, 77, 0, 2));
        assert_eq!(ip2, Ipv4Addr::new(10, 77, 0, 3));
    }
}
