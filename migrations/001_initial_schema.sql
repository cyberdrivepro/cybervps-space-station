-- ============================================================================
-- CyberVPS Space Station - Initial Database Schema Migration (001)
-- Supports SQLite and PostgreSQL with uniform relational conventions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

CREATE TABLE IF NOT EXISTS machines (
    id VARCHAR(128) PRIMARY KEY,
    hostname VARCHAR(255) NOT NULL,
    username VARCHAR(128),
    os VARCHAR(64) NOT NULL,
    os_version VARCHAR(128),
    arch VARCHAR(32) NOT NULL,
    virtual_ip VARCHAR(64),
    agent_version VARCHAR(64),
    status VARCHAR(32) DEFAULT 'online',
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    capabilities TEXT, -- JSON array of capabilities
    profile TEXT,      -- JSON object of hardware & runtime profile
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked BOOLEAN DEFAULT 0,
    revocation_reason TEXT
);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
    token VARCHAR(128) PRIMARY KEY,
    type VARCHAR(32) DEFAULT 'standard',
    machine_id VARCHAR(128),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    used BOOLEAN DEFAULT 0,
    revoked BOOLEAN DEFAULT 0,
    issued_by VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS bridge_mappings (
    id VARCHAR(128) PRIMARY KEY,
    machine_id VARCHAR(128) NOT NULL,
    local_port INTEGER NOT NULL,
    remote_port INTEGER NOT NULL,
    protocol VARCHAR(16) DEFAULT 'tcp',
    status VARCHAR(32) DEFAULT 'active',
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    active_connections INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tunnels (
    id VARCHAR(128) PRIMARY KEY,
    machine_id VARCHAR(128) NOT NULL,
    target_port INTEGER NOT NULL,
    public_url VARCHAR(512) NOT NULL,
    protocol VARCHAR(16) DEFAULT 'https',
    provider VARCHAR(64) DEFAULT 'cloudflare',
    status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS backends (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url VARCHAR(512) NOT NULL,
    role VARCHAR(32) DEFAULT 'primary',
    state VARCHAR(32) DEFAULT 'healthy',
    latency_ms INTEGER DEFAULT 0,
    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    failures_count INTEGER DEFAULT 0,
    epoch INTEGER DEFAULT 1,
    weight INTEGER DEFAULT 100
);

CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR(128) PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    severity VARCHAR(16) DEFAULT 'INFO',
    actor VARCHAR(128) DEFAULT 'system',
    action VARCHAR(128) NOT NULL,
    target VARCHAR(128),
    details TEXT, -- JSON payload
    correlation_id VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS plugins (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(32) NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    description TEXT,
    capabilities TEXT -- JSON array
);

CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    role VARCHAR(32) DEFAULT 'operator',
    token_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    revoked BOOLEAN DEFAULT 0
);
