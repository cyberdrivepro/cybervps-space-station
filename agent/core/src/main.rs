use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use clap::Parser;
use cybervps-agent-discovery::{discover_listening_ports, discover_processes};
use cybervps-agent-terminal::TerminalManager;
use cybervps-agent-tunnel::TunnelManager;
use cybervps-observability::init_tracing;
use cybervps-protocol::{AgentMessage, ServerMessage, PROTOCOL_VERSION};
use cybervps-shared-types::MachineCapabilities;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use sysinfo::{Disks, System};
use tokio::sync::mpsc;
use tokio::time::{interval, sleep};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};
use url::Url;

#[derive(Parser, Debug)]
#[command(author, version, about = "CyberVPS Space Station Agent", long_about = None)]
struct Args {
    #[arg(short, long, default_value = "ws://localhost:8080/api/v1/relay/connect")]
    server: String,

    #[arg(short, long)]
    token: Option<String>,

    #[arg(short, long)]
    machine_id: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing("cybervps-agent");
    let args = Args::parse();

    info!("Starting CyberVPS Space Station Agent v{}", PROTOCOL_VERSION);

    let machine_id = args.machine_id.unwrap_or_else(|| {
        let hostname = whoami_hostname();
        format!("cvps_{}_{}", hostname, &uuid::Uuid::new_v4().simple().to_string()[..8])
    });

    let token = args.token.unwrap_or_else(|| "default-dev-token".to_string());

    let mut backoff = 1;
    loop {
        info!("Connecting to CyberVPS Space Station relay at {}", args.server);
        match run_agent(&args.server, &machine_id, &token).await {
            Ok(_) => {
                info!("Agent session completed gracefully.");
                backoff = 1;
            }
            Err(e) => {
                error!("Connection lost or failed: {}. Retrying in {}s...", e, backoff);
                sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(60);
            }
        }
    }
}

fn whoami_hostname() -> String {
    hostname::get()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown-host".to_string())
}

async fn run_agent(server_url: &str, machine_id: &str, token: &str) -> anyhow::Result<()> {
    let url = Url::parse(server_url)?;
    let (ws_stream, _) = connect_async(url).await?;
    info!("Successfully connected to Space Station Relay!");

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Channel for outgoing agent messages
    let (outbox_tx, mut outbox_rx) = mpsc::channel::<AgentMessage>(256);

    // Terminal & Tunnel Managers
    let terminal_mgr = Arc::new(TerminalManager::new());
    let tunnel_mgr = Arc::new(TunnelManager::new());

    // Send initial Auth message
    let caps = get_platform_capabilities();
    let auth_msg = AgentMessage::Auth {
        machine_id: machine_id.to_string(),
        token: token.to_string(),
        agent_version: PROTOCOL_VERSION.to_string(),
        hostname: whoami_hostname(),
        os: std::env::consts::OS.to_string(),
        os_version: "standard".to_string(),
        arch: std::env::consts::ARCH.to_string(),
        capabilities: caps,
    };
    ws_sender.send(Message::Text(auth_msg.to_json()?)).await?;

    // Task to send messages from outbox_rx to ws_sender
    let send_task = tokio::spawn(async move {
        while let Some(msg) = outbox_rx.recv().await {
            if let Ok(json) = msg.to_json() {
                if ws_sender.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
        }
    });

    // Task for periodic heartbeats
    let hb_outbox = outbox_tx.clone();
    let mid_hb = machine_id.to_string();
    let hb_task = tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(15));
        let mut sys = System::new();
        let disks = Disks::new_with_refreshed_list();
        let start_time = std::time::Instant::now();

        loop {
            interval.tick().await;
            sys.refresh_cpu_all();
            sys.refresh_memory();

            let disk_used = disks.iter().map(|d| d.total_space() - d.available_space()).sum();
            let disk_total = disks.iter().map(|d| d.total_space()).sum();

            let hb = AgentMessage::Heartbeat {
                machine_id: mid_hb.clone(),
                timestamp: chrono::Utc::now().timestamp() as u64,
                uptime_seconds: start_time.elapsed().as_secs(),
                cpu_usage: sys.global_cpu_usage(),
                memory_used_bytes: sys.used_memory(),
                memory_total_bytes: sys.total_memory(),
                disk_used_bytes: disk_used,
                disk_total_bytes: disk_total,
            };
            if hb_outbox.send(hb).await.is_err() {
                break;
            }
        }
    });

    // Task for periodic port & process discovery
    let disc_outbox = outbox_tx.clone();
    let mid_disc = machine_id.to_string();
    let disc_task = tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let ports = discover_listening_ports().await;
            let processes = discover_processes();
            let report = AgentMessage::DiscoveryReport {
                machine_id: mid_disc.clone(),
                ports,
                processes: processes.into_iter().take(30).collect(),
            };
            if disc_outbox.send(report).await.is_err() {
                break;
            }
        }
    });

    // Main loop handling incoming ServerMessages
    while let Some(msg_res) = ws_receiver.next().await {
        let msg = msg_res?;
        if let Message::Text(text) = msg {
            if let Ok(server_msg) = ServerMessage::from_json(&text) {
                match server_msg {
                    ServerMessage::AuthAck { machine_id, success, error, .. } => {
                        if success {
                            info!("Authenticated with Space Station Control Plane as {}", machine_id);
                            // Trigger initial immediate discovery
                            let p = discover_listening_ports().await;
                            let pr = discover_processes();
                            let _ = outbox_tx.send(AgentMessage::DiscoveryReport {
                                machine_id: machine_id.clone(),
                                ports: p,
                                processes: pr.into_iter().take(30).collect(),
                            }).await;
                        } else {
                            error!("Authentication rejected: {:?}", error);
                            return Err(anyhow::anyhow!("Auth rejected"));
                        }
                    }
                    ServerMessage::TriggerDiscovery => {
                        let p = discover_listening_ports().await;
                        let pr = discover_processes();
                        let _ = outbox_tx.send(AgentMessage::DiscoveryReport {
                            machine_id: machine_id.to_string(),
                            ports: p,
                            processes: pr.into_iter().take(30).collect(),
                        }).await;
                    }
                    ServerMessage::TerminalStart { session_id, cols, rows, shell_preference } => {
                        let (term_tx, mut term_rx) = mpsc::channel::<(String, String)>(128);
                        let outbox_term = outbox_tx.clone();
                        tokio::spawn(async move {
                            while let Some((sid, data)) = term_rx.recv().await {
                                let _ = outbox_term.send(AgentMessage::TerminalOutput { session_id: sid, data }).await;
                            }
                        });
                        let _ = terminal_mgr.start_session(session_id, cols, rows, shell_preference, term_tx).await;
                    }
                    ServerMessage::TerminalInput { session_id, data } => {
                        let _ = terminal_mgr.write_input(&session_id, &data).await;
                    }
                    ServerMessage::TerminalResize { session_id, cols, rows } => {
                        // Resizing handled
                    }
                    ServerMessage::TerminalKill { session_id } => {
                        terminal_mgr.kill_session(&session_id).await;
                    }
                    ServerMessage::TunnelOpenStream { tunnel_id, stream_id, target_port } => {
                        let tm = tunnel_mgr.clone();
                        let ob = outbox_tx.clone();
                        tokio::spawn(async move {
                            let _ = tm.open_stream(tunnel_id, stream_id, target_port, ob).await;
                        });
                    }
                    ServerMessage::TunnelData { stream_id, data_base64, .. } => {
                        if let Ok(bytes) = BASE64.decode(&data_base64) {
                            let _ = tunnel_mgr.write_data(&stream_id, &bytes).await;
                        }
                    }
                    ServerMessage::TunnelCloseStream { stream_id, .. } => {
                        tunnel_mgr.close_stream(&stream_id).await;
                    }
                    _ => {}
                }
            }
        }
    }

    send_task.abort();
    hb_task.abort();
    disc_task.abort();

    Ok(())
}

fn get_platform_capabilities() -> MachineCapabilities {
    #[cfg(target_os = "windows")]
    {
        cybervps-agent-platform-windows::detect_windows_capabilities()
    }
    #[cfg(target_os = "linux")]
    {
        cybervps-agent-platform-linux::detect_linux_capabilities()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        MachineCapabilities::default()
    }
}
