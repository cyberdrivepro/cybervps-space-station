use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use cybervps-configuration::ControlPlaneConfig;
use cybervps-observability::init_tracing;
use cybervps-security::{generate_enrollment_token, has_permission, Permission};
use cybervps-shared-types::{AccessMode, MachineInfo, MachineStatus, PortObservation, TunnelConfig, TunnelStatus, UserRole};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::info;
use uuid::Uuid;

pub struct AppState {
    pub machines: Arc<RwLock<HashMap<String, MachineInfo>>>,
    pub ports: Arc<RwLock<HashMap<String, Vec<PortObservation>>>>,
    pub tunnels: Arc<RwLock<HashMap<String, TunnelConfig>>>,
    pub tokens: Arc<RwLock<Vec<String>>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing("cybervps-control-plane");
    let config = ControlPlaneConfig::from_env();

    let state = Arc::new(AppState {
        machines: Arc::new(RwLock::new(HashMap::new())),
        ports: Arc::new(RwLock::new(HashMap::new())),
        tunnels: Arc::new(RwLock::new(HashMap::new())),
        tokens: Arc::new(RwLock::new(vec!["cvps_enroll_master_token".to_string()])),
    });

    let app = Router::new()
        .route("/health", get(|| async { "OK" }))
        .route("/api/v1/machines", get(list_machines))
        .route("/api/v1/machines/:id", get(get_machine))
        .route("/api/v1/machines/:id/ports", get(get_machine_ports))
        .route("/api/v1/enrollment/token", post(create_enrollment_token))
        .route("/api/v1/tunnels", get(list_tunnels).post(create_tunnel))
        .route("/api/v1/tunnels/:id/revoke", post(revoke_tunnel))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    info!("CyberVPS Space Station Control Plane running at http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn list_machines(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let map = state.machines.read().await;
    let list: Vec<MachineInfo> = map.values().cloned().collect();
    Json(list)
}

async fn get_machine(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let map = state.machines.read().await;
    match map.get(&id) {
        Some(m) => Json(serde_json::to_value(m).unwrap()),
        None => Json(serde_json::json!({ "error": "Machine not found" })),
    }
}

async fn get_machine_ports(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let map = state.ports.read().await;
    let ports = map.get(&id).cloned().unwrap_or_default();
    Json(ports)
}

async fn create_enrollment_token(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let token = generate_enrollment_token();
    let mut tokens = state.tokens.write().await;
    tokens.push(token.clone());
    Json(serde_json::json!({
        "token": token,
        "expires_in_seconds": 3600
    }))
}

async fn list_tunnels(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let map = state.tunnels.read().await;
    let list: Vec<TunnelConfig> = map.values().cloned().collect();
    Json(list)
}

#[derive(serde::Deserialize)]
pub struct CreateTunnelReq {
    pub machine_id: String,
    pub target_port: u16,
    pub access_mode: AccessMode,
}

async fn create_tunnel(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTunnelReq>,
) -> impl IntoResponse {
    let id = format!("tun_{}", &Uuid::new_v4().simple().to_string()[..8]);
    let subdomain = format!("{}-{}", req.target_port, &id);
    let gateway_base = std::env::var("PUBLIC_GATEWAY_URL")
        .or_else(|_| std::env::var("GATEWAY_URL"))
        .unwrap_or_else(|_| "http://localhost:8081".to_string());
    let public_url = format!("{}/tunnel/{}/", gateway_base.trim_end_matches('/'), id);

    let tunnel = TunnelConfig {
        id: id.clone(),
        machine_id: req.machine_id,
        target_port: req.target_port,
        public_subdomain: subdomain,
        public_url,
        access_mode: req.access_mode,
        access_token: None,
        status: TunnelStatus::Active,
        created_at: chrono::Utc::now(),
        request_count: 0,
        bytes_transferred: 0,
    };

    let mut map = state.tunnels.write().await;
    map.insert(id.clone(), tunnel.clone());

    Json(tunnel)
}

async fn revoke_tunnel(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let mut map = state.tunnels.write().await;
    if let Some(t) = map.get_mut(&id) {
        t.status = TunnelStatus::Revoked;
        Json(serde_json::json!({ "success": true, "status": "revoked" }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Tunnel not found" }))
    }
}
