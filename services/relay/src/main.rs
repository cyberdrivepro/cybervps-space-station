use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use cybervps_configuration::ControlPlaneConfig;
use cybervps_observability::init_tracing;
use cybervps_protocol::{AgentMessage, ServerMessage};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{error, info, warn};

pub struct ConnectedAgent {
    pub machine_id: String,
    pub tx: mpsc::Sender<ServerMessage>,
}

pub struct RelayState {
    pub agents: Arc<RwLock<HashMap<String, ConnectedAgent>>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing("cybervps-relay");
    let config = ControlPlaneConfig::from_env();

    let state = Arc::new(RelayState {
        agents: Arc::new(RwLock::new(HashMap::new())),
    });

    let app = Router::new()
        .route("/api/v1/relay/connect", get(ws_handler))
        .route("/health", get(|| async { "OK" }))
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    info!("CyberVPS Space Station Relay listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<RelayState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_agent_socket(socket, state))
}

async fn handle_agent_socket(socket: WebSocket, state: Arc<RelayState>) {
    let (mut sender, mut receiver) = socket.split();
    let (agent_tx, mut agent_rx) = mpsc::channel::<ServerMessage>(128);

    let mut current_machine_id: Option<String> = None;

    // Task forwarding server messages to agent WebSocket
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = agent_rx.recv().await {
            if let Ok(json) = msg.to_json() {
                if sender.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
        }
    });

    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            if let Ok(agent_msg) = AgentMessage::from_json(&text) {
                match agent_msg {
                    AgentMessage::Auth { machine_id, token, .. } => {
                        info!("Agent auth request from machine: {}", machine_id);
                        current_machine_id = Some(machine_id.clone());
                        let mut map = state.agents.write().await;
                        map.insert(
                            machine_id.clone(),
                            ConnectedAgent {
                                machine_id: machine_id.clone(),
                                tx: agent_tx.clone(),
                            },
                        );

                        let ack = ServerMessage::AuthAck {
                            machine_id,
                            success: true,
                            error: None,
                            heartbeat_interval_secs: 15,
                        };
                        let _ = agent_tx.send(ack).await;
                    }
                    AgentMessage::Heartbeat { machine_id, uptime_seconds, cpu_usage, .. } => {
                        info!("Heartbeat from {}: cpu={:.1}%, uptime={}s", machine_id, cpu_usage, uptime_seconds);
                    }
                    AgentMessage::DiscoveryReport { machine_id, ports, .. } => {
                        info!("Discovery report from {}: {} listening ports found", machine_id, ports.len());
                    }
                    _ => {}
                }
            }
        }
    }

    forward_task.abort();
    if let Some(id) = current_machine_id {
        let mut map = state.agents.write().await;
        map.remove(&id);
        info!("Machine {} disconnected from relay", id);
    }
}
