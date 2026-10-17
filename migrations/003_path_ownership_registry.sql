-- ============================================================================
-- CyberVPS Space Station - Database Schema Migration (003)
-- Path Ownership Invariant, Deletion/Movement Tracking & Infrastructure Topology
-- ============================================================================

CREATE TABLE IF NOT EXISTS path_ownership_registry (
    resource_id VARCHAR(128) PRIMARY KEY,
    machine_id VARCHAR(128) NOT NULL,
    canonical_path VARCHAR(1024) NOT NULL,
    logical_path VARCHAR(1024) NOT NULL,
    resource_type VARCHAR(64) DEFAULT 'backend', -- service, backend, file, directory, volume, snapshot
    backend_id VARCHAR(128) NOT NULL,
    ownership_role VARCHAR(32) DEFAULT 'primary', -- primary, replica, backup, cache, unknown
    state VARCHAR(32) DEFAULT 'healthy', -- healthy, stale, missing, moved, recovering, recovered, conflicted, lost, unknown
    lease_token VARCHAR(128),
    lease_expires_at TIMESTAMP,
    checksum VARCHAR(128),
    manifest_version VARCHAR(64) DEFAULT '1.0.0',
    recovery_source VARCHAR(255),
    last_verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_known_location VARCHAR(1024),
    current_location VARCHAR(1024),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_tombstone BOOLEAN DEFAULT 0
);

-- Unique index ensuring: For any canonical writable filesystem path on a machine, exactly ONE authoritative primary writer may own it
CREATE UNIQUE INDEX IF NOT EXISTS idx_machine_canonical_primary 
ON path_ownership_registry(machine_id, canonical_path) 
WHERE ownership_role = 'primary' AND is_tombstone = 0;

CREATE INDEX IF NOT EXISTS idx_registry_backend ON path_ownership_registry(backend_id);
CREATE INDEX IF NOT EXISTS idx_registry_machine ON path_ownership_registry(machine_id);
CREATE INDEX IF NOT EXISTS idx_registry_state ON path_ownership_registry(state);

-- Path Ownership Conflicts table for logging competing ownership claims
CREATE TABLE IF NOT EXISTS path_conflicts (
    conflict_id VARCHAR(128) PRIMARY KEY,
    machine_id VARCHAR(128) NOT NULL,
    canonical_path VARCHAR(1024) NOT NULL,
    existing_owner_backend VARCHAR(128) NOT NULL,
    competing_owner_backend VARCHAR(128) NOT NULL,
    conflict_type VARCHAR(64) NOT NULL, -- duplicate_writer, nested_directory, lease_violation
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) DEFAULT 'active', -- active, resolved, dismissed
    resolution_policy VARCHAR(64),
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(128),
    details TEXT -- JSON metadata of the conflict
);

CREATE INDEX IF NOT EXISTS idx_conflict_machine ON path_conflicts(machine_id);
CREATE INDEX IF NOT EXISTS idx_conflict_status ON path_conflicts(status);

-- Complete Before-and-After Deletion, Movement and Replacement Event Log
CREATE TABLE IF NOT EXISTS resource_movement_history (
    event_id VARCHAR(128) PRIMARY KEY,
    resource_id VARCHAR(128) NOT NULL,
    machine_id VARCHAR(128) NOT NULL,
    old_path VARCHAR(1024),
    new_path VARCHAR(1024),
    old_host VARCHAR(128),
    new_host VARCHAR(128),
    event_type VARCHAR(64) NOT NULL, -- created, verified, moved, missing, candidate_found, recovering, recovered, tombstone, conflict
    detection_source VARCHAR(128) NOT NULL, -- agent_heartbeat, periodic_scan, api_mutation, fs_watch
    recovery_source VARCHAR(255),
    checksum_before VARCHAR(128),
    checksum_after VARCHAR(128),
    confidence_score INTEGER DEFAULT 100,
    evidence TEXT, -- JSON details of the match/move
    initiator VARCHAR(128) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_history_resource ON resource_movement_history(resource_id);
CREATE INDEX IF NOT EXISTS idx_history_machine ON resource_movement_history(machine_id);
CREATE INDEX IF NOT EXISTS idx_history_event_type ON resource_movement_history(event_type);

-- Host Telemetry Attributes & Verified Network Topology
CREATE TABLE IF NOT EXISTS infrastructure_attributes (
    machine_id VARCHAR(128) NOT NULL,
    attr_key VARCHAR(128) NOT NULL,
    attr_value TEXT NOT NULL,
    category VARCHAR(64) DEFAULT 'telemetry', -- network, hardware, permission, storage
    verified_state VARCHAR(32) DEFAULT 'detected', -- configured, detected, reachable, authenticated, verified
    verification_method VARCHAR(128),
    last_verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (machine_id, attr_key)
);
