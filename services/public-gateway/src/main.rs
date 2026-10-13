use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use cybervps-configuration::ControlPlaneConfig;
use cybervps-observability::init_tracing;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::{error, info};

pub struct GatewayState {
    pub base_domain: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing("cybervps-public-gateway");
    let config = ControlPlaneConfig::from_env();

    let state = Arc::new(GatewayState {
        base_domain: config.base_domain,
    });

    let app = Router::new()
        .route("/tunnel/:tunnel_id", any(proxy_tunnel_root))
        .route("/tunnel/:tunnel_id/*path", any(proxy_tunnel_path))
        .with_state(state);

    let gateway_port = 8081;
    let addr: SocketAddr = format!("0.0.0.0:{}", gateway_port).parse()?;
    info!("CyberVPS Space Station Public Gateway listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn proxy_tunnel_root(
    Path(tunnel_id): Path<String>,
    req: Request<Body>,
    State(_state): State<Arc<GatewayState>>,
) -> Response {
    handle_proxy_stream(&tunnel_id, "", req).await
}

async fn proxy_tunnel_path(
    Path((tunnel_id, path)): Path<(String, String)>,
    req: Request<Body>,
    State(_state): State<Arc<GatewayState>>,
) -> Response {
    handle_proxy_stream(&tunnel_id, &path, req).await
}

async fn handle_proxy_stream(tunnel_id: &str, _path: &str, _req: Request<Body>) -> Response {
    info!("Gateway routing request for tunnel: {}", tunnel_id);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static("text/html"))
        .body(Body::from(format!(
            "<h1>CyberVPS Space Station Gateway</h1><p>Active tunnel: {}</p>",
            tunnel_id
        )))
        .unwrap()
}
