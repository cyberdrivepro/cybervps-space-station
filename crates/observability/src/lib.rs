use std::sync::atomic::{AtomicU64, Ordering};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[derive(Default)]
pub struct SpaceStationMetrics {
    pub active_machines: AtomicU64,
    pub active_tunnels: AtomicU64,
    pub active_terminals: AtomicU64,
    pub total_requests_routed: AtomicU64,
    pub total_bytes_streamed: AtomicU64,
}

impl SpaceStationMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn inc_machines(&self) {
        self.active_machines.fetch_add(1, Ordering::Relaxed);
    }

    pub fn dec_machines(&self) {
        self.active_machines.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn inc_tunnels(&self) {
        self.active_tunnels.fetch_add(1, Ordering::Relaxed);
    }

    pub fn dec_tunnels(&self) {
        self.active_tunnels.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn inc_terminals(&self) {
        self.active_terminals.fetch_add(1, Ordering::Relaxed);
    }

    pub fn dec_terminals(&self) {
        self.active_terminals.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn add_bytes(&self, bytes: u64) {
        self.total_bytes_streamed.fetch_add(bytes, Ordering::Relaxed);
    }

    pub fn inc_requests(&self) {
        self.total_requests_routed.fetch_add(1, Ordering::Relaxed);
    }
}

pub fn init_tracing(service_name: &str) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,cybervps=debug"));

    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true);

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt_layer)
        .try_init();

    tracing::info!(service = service_name, "Observability subsystem initialized");
}
