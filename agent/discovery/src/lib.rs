use chrono::Utc;
use cybervps_shared_types::{PortObservation, ProcessObservation, Protocol};
use std::process::Command;
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

/// Probe a local TCP port to determine if it speaks HTTP and WebSocket
pub async fn probe_http_service(port: u16) -> (bool, Option<u16>, Option<String>, bool) {
    let addr = format!("127.0.0.1:{}", port);
    let connect_fut = TcpStream::connect(&addr);

    let mut stream = match timeout(Duration::from_millis(600), connect_fut).await {
        Ok(Ok(s)) => s,
        _ => return (false, None, None, false),
    };

    let probe_req = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nUser-Agent: CyberVPS-Probe/1.0\r\nAccept: */*\r\nConnection: close\r\n\r\n",
        port
    );

    if stream.write_all(probe_req.as_bytes()).await.is_err() {
        return (false, None, None, false);
    }

    let mut buf = [0u8; 4096];
    let read_fut = stream.read(&mut buf);
    let n = match timeout(Duration::from_millis(800), read_fut).await {
        Ok(Ok(n)) if n > 0 => n,
        _ => return (false, None, None, false),
    };

    let response = String::from_utf8_lossy(&buf[..n]);
    if !response.starts_with("HTTP/") {
        return (false, None, None, false);
    }

    let status_code = response
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u16>().ok());

    let mut title = None;
    if let Some(start) = response.to_lowercase().find("<title>") {
        if let Some(end) = response.to_lowercase().find("</title>") {
            if end > start + 7 {
                title = Some(response[start + 7..end].trim().to_string());
            }
        }
    }

    let has_ws = response.to_lowercase().contains("upgrade: websocket")
        || response.to_lowercase().contains("sec-websocket-accept");

    (true, status_code, title, has_ws)
}

/// Discover listening TCP ports using cross-platform tools
pub async fn discover_listening_ports() -> Vec<PortObservation> {
    let mut ports = Vec::new();
    let now = Utc::now();

    #[cfg(target_os = "windows")]
    {
        // Query netstat on Windows
        if let Ok(output) = Command::new("netstat").args(["-ano", "-p", "tcp"]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 && parts[0].eq_ignore_ascii_case("TCP") && parts[3].eq_ignore_ascii_case("LISTENING") {
                    let local_addr = parts[1];
                    let pid: Option<u32> = parts.get(4).and_then(|p| p.parse().ok());
                    if let Some(colon_pos) = local_addr.rfind(':') {
                        let port_str = &local_addr[colon_pos + 1..];
                        if let Ok(port) = port_str.parse::<u16>() {
                            if !ports.iter().any(|p: &PortObservation| p.port == port) {
                                ports.push(PortObservation {
                                    port,
                                    protocol: Protocol::Tcp,
                                    bind_address: local_addr[..colon_pos].to_string(),
                                    pid,
                                    process_name: None,
                                    is_http: false,
                                    http_status: None,
                                    http_title: None,
                                    has_websocket: false,
                                    last_discovered: now,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Query ss on Linux
        if let Ok(output) = Command::new("ss").args(["-tulpn", "-H"]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 5 && parts[1].eq_ignore_ascii_case("LISTEN") {
                    let local_addr = parts[4];
                    if let Some(colon_pos) = local_addr.rfind(':') {
                        let port_str = &local_addr[colon_pos + 1..];
                        if let Ok(port) = port_str.parse::<u16>() {
                            let mut pid = None;
                            let mut proc_name = None;
                            if let Some(proc_col) = parts.get(6) {
                                if let Some(p_idx) = proc_col.find("pid=") {
                                    let pid_part = &proc_col[p_idx + 4..];
                                    let end_idx = pid_part.find(',').unwrap_or(pid_part.find(')').unwrap_or(pid_part.len()));
                                    pid = pid_part[..end_idx].parse::<u32>().ok();
                                }
                                if let Some(u_idx) = proc_col.find("(\"") {
                                    if let Some(end_u) = proc_col[u_idx + 2..].find('\"') {
                                        proc_name = Some(proc_col[u_idx + 2..u_idx + 2 + end_u].to_string());
                                    }
                                }
                            }
                            if !ports.iter().any(|p: &PortObservation| p.port == port) {
                                ports.push(PortObservation {
                                    port,
                                    protocol: Protocol::Tcp,
                                    bind_address: local_addr[..colon_pos].to_string(),
                                    pid,
                                    process_name: proc_name,
                                    is_http: false,
                                    http_status: None,
                                    http_title: None,
                                    has_websocket: false,
                                    last_discovered: now,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Now probe listening ports for HTTP capabilities
    for obs in ports.iter_mut() {
        let (is_http, status, title, has_ws) = probe_http_service(obs.port).await;
        obs.is_http = is_http;
        obs.http_status = status;
        obs.http_title = title;
        obs.has_websocket = has_ws;
    }

    ports
}

/// Discover running processes
pub fn discover_processes() -> Vec<ProcessObservation> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut list = Vec::new();
    for (pid, proc) in sys.processes() {
        list.push(ProcessObservation {
            pid: pid.as_u32(),
            name: proc.name().to_string_lossy().to_string(),
            cpu_usage: proc.cpu_usage(),
            memory_bytes: proc.memory(),
            user: proc.user_id().map(|u| u.to_string()),
            command: Some(proc.cmd().join(" ")),
        });
    }
    list
}
