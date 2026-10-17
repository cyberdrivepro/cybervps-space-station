-- ============================================================================
-- CyberVPS Space Station - Cluster, Obsidian Pillars & Disaster Recovery (002)
-- Durable state for distributed mesh, recovery profiles, and hardware manifests.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cluster_nodes (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(64) NOT NULL,
    endpoint VARCHAR(512) NOT NULL,
    role VARCHAR(32) DEFAULT 'observer',
    state VARCHAR(32) DEFAULT 'healthy',
    epoch INTEGER DEFAULT 1,
    fencing_token INTEGER DEFAULT 1,
    generation INTEGER DEFAULT 1,
    is_tombstoned BOOLEAN DEFAULT 0,
    last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_path TEXT,
    manifest_signature TEXT
);

CREATE TABLE IF NOT EXISTS recovery_profiles (
    machine_id VARCHAR(128) PRIMARY KEY,
    device_name VARCHAR(255) NOT NULL,
    hardware_uuid VARCHAR(128) NOT NULL,
    hardware_serial VARCHAR(128),
    recovery_mode VARCHAR(64) DEFAULT 'usb_unattended',
    installation_generation INTEGER DEFAULT 1,
    status VARCHAR(32) DEFAULT 'ready',
    auto_approve BOOLEAN DEFAULT 1,
    history TEXT, -- JSON array of events
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recovery_tickets (
    ticket VARCHAR(128) PRIMARY KEY,
    machine_id VARCHAR(128) NOT NULL,
    hardware_uuid VARCHAR(128) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT 0,
    issued_by VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS cluster_manifests (
    id VARCHAR(128) PRIMARY KEY,
    cluster_epoch INTEGER NOT NULL,
    fencing_token INTEGER NOT NULL,
    manifest_hash VARCHAR(128) NOT NULL,
    signature VARCHAR(256) NOT NULL,
    payload TEXT NOT NULL, -- Full JSON cluster snapshot
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_machines_status ON machines(status);
CREATE INDEX IF NOT EXISTS idx_machines_last_seen ON machines(last_seen);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_cluster_nodes_state ON cluster_nodes(state);
CREATE INDEX IF NOT EXISTS idx_recovery_profiles_uuid ON recovery_profiles(hardware_uuid);
