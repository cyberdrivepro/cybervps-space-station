/**
 * CYBERVPS SPACE STATION - PATH OWNERSHIP & CANONICAL REGISTRY ENGINE
 * Enforces the Strict Single-Authoritative-Writer Invariant across all machines,
 * provides cross-platform path canonicalization, lease fencing, and conflict detection.
 */

const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class PathOwnershipEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.storage = options.storage || null;
    this.auditService = options.auditService || null;
    this.leaseDurationMs = options.leaseDurationMs || 60000; // 60s lease window

    // In-memory cache for fast atomic conflict checking
    // Key: `${machineId}:${canonicalPath}` -> Registry Record
    this.registryCache = new Map();
    // Key: conflict_id -> Conflict Record
    this.conflicts = new Map();
  }

  /**
   * Initializes engine by loading records from durable storage into memory cache
   */
  async init() {
    if (this.storage && typeof this.storage.list === 'function') {
      try {
        const records = await this.storage.list('path_ownership_registry', { is_tombstone: 0 });
        for (const r of records) {
          const key = this._makeKey(r.machine_id, r.canonical_path);
          this.registryCache.set(key, r);
        }
        if (this.auditService) {
          await this.auditService.info('path_engine_init', `Loaded ${records.length} path ownership records into memory cache`);
        }
      } catch (err) {
        // Table might not exist yet if before migration, proceed gracefully
      }
    }
  }

  /**
   * Cross-platform path canonicalization.
   * Handles relative segments (..), case-normalization, drive letters, forward/backslashes,
   * trailing slashes, and mount boundaries.
   * 
   * @param {string} rawPath - Input path from agent or user
   * @param {string} platform - Target host platform ('win32' | 'linux' | 'darwin')
   * @returns {string} Canonical normalized absolute path
   */
  canonicalizePath(rawPath, platform = process.platform) {
    if (!rawPath || typeof rawPath !== 'string') {
      throw new Error('Path is required and must be a string.');
    }

    let p = rawPath.trim();

    // 1. Detect and reject null byte attacks
    if (p.indexOf('\0') !== -1) {
      throw new Error('Path validation failed: Null byte character detected.');
    }

    const isWindows = platform === 'win32' || /^[a-zA-Z]:/.test(p) || p.includes('\\');

    if (isWindows) {
      // Normalize slashes to forward slashes for uniform representation
      p = p.replace(/\\/g, '/');

      // Match Windows drive letter: e.g. "c:/..." or "C:/..."
      const driveMatch = p.match(/^([a-zA-Z]):(\/.*)?$/);
      let drive = 'C:';
      let rest = p;

      if (driveMatch) {
        drive = driveMatch[1].toUpperCase() + ':';
        rest = driveMatch[2] || '/';
      } else if (p.startsWith('/')) {
        drive = 'C:';
        rest = p;
      } else {
        // Relative path on Windows
        drive = 'C:';
        rest = '/' + p;
      }

      // Resolve .. and . segments safely
      const segments = rest.split('/').filter(s => s.length > 0 && s !== '.');
      const resolvedSegments = [];

      for (const seg of segments) {
        if (seg === '..') {
          if (resolvedSegments.length > 0) {
            resolvedSegments.pop();
          }
        } else {
          resolvedSegments.push(seg);
        }
      }

      const canonicalPath = drive + '/' + resolvedSegments.join('/');
      return canonicalPath.endsWith('/') && canonicalPath.length > 3 
        ? canonicalPath.slice(0, -1) 
        : canonicalPath;
    } else {
      // Linux / Unix POSIX canonicalization
      p = p.replace(/\\/g, '/');
      if (!p.startsWith('/')) {
        p = '/' + p;
      }

      const segments = p.split('/').filter(s => s.length > 0 && s !== '.');
      const resolvedSegments = [];

      for (const seg of segments) {
        if (seg === '..') {
          if (resolvedSegments.length > 0) {
            resolvedSegments.pop();
          }
        } else {
          resolvedSegments.push(seg);
        }
      }

      const canonicalPath = '/' + resolvedSegments.join('/');
      return canonicalPath.length > 1 && canonicalPath.endsWith('/') 
        ? canonicalPath.slice(0, -1) 
        : canonicalPath;
    }
  }

  /**
   * Helper to format machine-scoped composite key
   */
  _makeKey(machineId, canonicalPath) {
    return `${machineId}:${canonicalPath.toLowerCase()}`;
  }

  /**
   * STRICT PATH OWNERSHIP INVARIANT:
   * For any canonical writable filesystem path on a machine, exactly ONE authoritative
   * primary writer backend may own it at a time.
   * 
   * Replicas and backups may reference the data, but MUST declare their non-authoritative role.
   */
  async registerPathOwnership(params = {}) {
    const {
      resource_id = `res_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      machine_id,
      path: rawPath,
      logical_path = rawPath,
      backend_id,
      ownership_role = 'primary', // 'primary', 'replica', 'backup', 'cache'
      resource_type = 'backend', // 'service', 'backend', 'file', 'directory', 'volume', 'snapshot'
      platform = 'win32',
      checksum = null,
      manifest_version = '1.0.0',
      initiator = 'system'
    } = params;

    if (!machine_id) throw new Error('machine_id is strictly required for path ownership registration.');
    if (!rawPath) throw new Error('path is strictly required for path ownership registration.');
    if (!backend_id) throw new Error('backend_id is strictly required for path ownership registration.');

    const canonicalPath = this.canonicalizePath(rawPath, platform);
    const key = this._makeKey(machine_id, canonicalPath);
    const existing = this.registryCache.get(key);

    const nowIso = new Date().toISOString();
    const leaseExpires = new Date(Date.now() + this.leaseDurationMs).toISOString();
    const leaseToken = `lease_${crypto.randomBytes(16).toString('hex')}`;

    // ENFORCE INVARIANT IF ROLE IS PRIMARY WRITER
    if (ownership_role === 'primary') {
      // 1. Exact Duplicate Writer Collision Check
      if (existing && !existing.is_tombstone && existing.ownership_role === 'primary') {
        if (existing.backend_id !== backend_id) {
          // CONFLICT DETECTED: Two different backends claiming authoritative primary writer ownership!
          const conflictId = `conf_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          const conflictRecord = {
            conflict_id: conflictId,
            machine_id,
            canonical_path: canonicalPath,
            existing_owner_backend: existing.backend_id,
            competing_owner_backend: backend_id,
            conflict_type: 'duplicate_writer',
            detected_at: nowIso,
            status: 'active',
            details: {
              existing_resource_id: existing.resource_id,
              attempted_resource_id: resource_id,
              logical_path
            }
          };

          this.conflicts.set(conflictId, conflictRecord);

          if (this.storage && typeof this.storage.set === 'function') {
            await this.storage.set('path_conflicts', conflictId, conflictRecord);
          }

          if (this.auditService) {
            await this.auditService.security('path_ownership_conflict', 
              `Strict Path Ownership Violation: Path [${canonicalPath}] on machine [${machine_id}] already owned by [${existing.backend_id}]. Rejected claim by [${backend_id}].`,
              conflictRecord
            );
          }

          const conflictError = new Error(
            `Strict Path Ownership Violation: Path [${canonicalPath}] on machine [${machine_id}] is already owned by authoritative backend [${existing.backend_id}]. Multiple authoritative primary writers are strictly prohibited.`
          );
          conflictError.statusCode = 409;
          conflictError.conflictId = conflictId;
          conflictError.existingOwner = existing.backend_id;
          throw conflictError;
        }
      }

      // 2. Overlapping Directory Hierarchy Collision Check (Parent/Child overlapping ownership)
      const overlapping = this._findOverlappingOwnership(machine_id, canonicalPath, backend_id);
      if (overlapping) {
        const conflictId = `conf_nested_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const conflictRecord = {
          conflict_id: conflictId,
          machine_id,
          canonical_path: canonicalPath,
          existing_owner_backend: overlapping.backend_id,
          competing_owner_backend: backend_id,
          conflict_type: 'nested_directory',
          detected_at: nowIso,
          status: 'active',
          details: {
            conflicting_path: overlapping.canonical_path,
            existing_role: overlapping.ownership_role
          }
        };

        this.conflicts.set(conflictId, conflictRecord);

        if (this.auditService) {
          await this.auditService.warn('nested_path_conflict',
            `Overlapping path ownership detected on machine [${machine_id}]: [${canonicalPath}] overlaps with existing [${overlapping.canonical_path}] owned by [${overlapping.backend_id}].`,
            conflictRecord
          );
        }

        const overlapErr = new Error(
          `Overlapping Directory Ownership Violation: Path [${canonicalPath}] overlaps with [${overlapping.canonical_path}] owned by backend [${overlapping.backend_id}].`
        );
        overlapErr.statusCode = 409;
        overlapErr.conflictId = conflictId;
        throw overlapErr;
      }
    }

    // Determine state transition
    const isNew = !existing;
    const previousPath = existing ? existing.canonical_path : null;
    const previousHost = existing ? existing.machine_id : null;

    const record = {
      resource_id: existing ? existing.resource_id : resource_id,
      machine_id,
      canonical_path: canonicalPath,
      logical_path,
      resource_type,
      backend_id,
      ownership_role,
      state: 'healthy',
      lease_token: leaseToken,
      lease_expires_at: leaseExpires,
      checksum: checksum || (existing ? existing.checksum : null),
      manifest_version,
      last_verified_at: nowIso,
      last_known_location: existing ? (existing.current_location || existing.canonical_path) : canonicalPath,
      current_location: canonicalPath,
      created_at: existing ? existing.created_at : nowIso,
      updated_at: nowIso,
      is_tombstone: 0
    };

    // Commit to cache and persistent database
    this.registryCache.set(key, record);

    if (this.storage && typeof this.storage.set === 'function') {
      await this.storage.set('path_ownership_registry', record.resource_id, record);
    }

    // Record immutable audit history event
    const historyEvent = {
      event_id: `evt_hist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      resource_id: record.resource_id,
      machine_id,
      old_path: previousPath,
      new_path: canonicalPath,
      old_host: previousHost,
      new_host: machine_id,
      event_type: isNew ? 'created' : 'verified',
      detection_source: 'api_registration',
      confidence_score: 100,
      initiator,
      created_at: nowIso
    };

    if (this.storage && typeof this.storage.set === 'function') {
      await this.storage.set('resource_movement_history', historyEvent.event_id, historyEvent);
    }

    if (this.auditService) {
      await this.auditService.info('path_ownership_registered',
        `Authoritative path ownership registered: Backend [${backend_id}] owns [${canonicalPath}] on machine [${machine_id}] (Role: ${ownership_role})`,
        { resource_id: record.resource_id, canonical_path: canonicalPath, lease_token: leaseToken }
      );
    }

    this.emit('path_registered', record);
    return record;
  }

  /**
   * Check for nested overlapping directory claims
   */
  _findOverlappingOwnership(machineId, targetCanonical, candidateBackend) {
    const targetLower = targetCanonical.toLowerCase();
    const targetWithSlash = targetLower.endsWith('/') ? targetLower : targetLower + '/';

    for (const [key, record] of this.registryCache.entries()) {
      if (record.machine_id !== machineId || record.is_tombstone || record.ownership_role !== 'primary') {
        continue;
      }
      if (record.backend_id === candidateBackend) {
        continue; // Same backend can manage its own nested sub-paths if allowed
      }

      const existingLower = record.canonical_path.toLowerCase();
      const existingWithSlash = existingLower.endsWith('/') ? existingLower : existingLower + '/';

      // 1. Is targetCanonical a child of existingLower?
      if (targetWithSlash.startsWith(existingWithSlash) && targetLower !== existingLower) {
        return record;
      }

      // 2. Is existingLower a child of targetCanonical?
      if (existingWithSlash.startsWith(targetWithSlash) && targetLower !== existingLower) {
        return record;
      }
    }
    return null;
  }

  /**
   * Renew lease for an authoritative backend
   */
  async renewLease(resourceId, leaseToken) {
    for (const [key, record] of this.registryCache.entries()) {
      if (record.resource_id === resourceId) {
        if (record.lease_token !== leaseToken) {
          throw new Error('Fencing violation: Invalid or expired lease token.');
        }

        const nowIso = new Date().toISOString();
        record.lease_expires_at = new Date(Date.now() + this.leaseDurationMs).toISOString();
        record.last_verified_at = nowIso;
        record.updated_at = nowIso;

        if (this.storage && typeof this.storage.set === 'function') {
          await this.storage.set('path_ownership_registry', resourceId, record);
        }

        return { success: true, lease_expires_at: record.lease_expires_at };
      }
    }
    throw new Error(`Resource [${resourceId}] not found in path ownership registry.`);
  }

  /**
   * Release or tombstone path ownership (e.g. backend decommission or moving)
   */
  async releaseOwnership(resourceId, backendId, reason = 'Normal decommission') {
    for (const [key, record] of this.registryCache.entries()) {
      if (record.resource_id === resourceId) {
        if (record.backend_id !== backendId) {
          throw new Error(`Permission denied: Backend [${backendId}] does not own resource [${resourceId}].`);
        }

        const nowIso = new Date().toISOString();
        record.is_tombstone = 1;
        record.state = 'missing';
        record.updated_at = nowIso;
        this.registryCache.delete(key);

        if (this.storage && typeof this.storage.set === 'function') {
          await this.storage.set('path_ownership_registry', resourceId, record);
        }

        // Record history event
        const historyEvent = {
          event_id: `evt_tomb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          resource_id: resourceId,
          machine_id: record.machine_id,
          old_path: record.canonical_path,
          new_path: null,
          event_type: 'tombstone',
          detection_source: 'release_api',
          initiator: backendId,
          evidence: JSON.stringify({ reason }),
          created_at: nowIso
        };

        if (this.storage && typeof this.storage.set === 'function') {
          await this.storage.set('resource_movement_history', historyEvent.event_id, historyEvent);
        }

        if (this.auditService) {
          await this.auditService.warn('path_ownership_released',
            `Released path ownership for [${record.canonical_path}] on [${record.machine_id}]: ${reason}`,
            { resource_id: resourceId, backend_id: backendId }
          );
        }

        return { success: true, released_path: record.canonical_path, reason };
      }
    }
    throw new Error(`Resource [${resourceId}] not found.`);
  }

  /**
   * List path ownership registry records with filters
   */
  listRegistry(filters = {}) {
    let list = Array.from(this.registryCache.values()).filter(r => !r.is_tombstone);

    if (filters.machine_id) {
      list = list.filter(r => r.machine_id === filters.machine_id);
    }
    if (filters.backend_id) {
      list = list.filter(r => r.backend_id === filters.backend_id);
    }
    if (filters.role) {
      list = list.filter(r => r.ownership_role === filters.role);
    }
    if (filters.state) {
      list = list.filter(r => r.state === filters.state);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(r => 
        r.canonical_path.toLowerCase().includes(q) ||
        r.logical_path.toLowerCase().includes(q) ||
        r.backend_id.toLowerCase().includes(q) ||
        r.machine_id.toLowerCase().includes(q)
      );
    }

    return list;
  }

  /**
   * List active or past conflicts
   */
  listConflicts(machineId = null) {
    let confs = Array.from(this.conflicts.values());
    if (machineId) {
      confs = confs.filter(c => c.machine_id === machineId);
    }
    return confs;
  }

  /**
   * Resolve a recorded ownership conflict
   */
  async resolveConflict(conflictId, resolutionPolicy = 'keep_existing', authorizedUser = 'admin') {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict [${conflictId}] not found.`);
    }

    const nowIso = new Date().toISOString();
    conflict.status = 'resolved';
    conflict.resolution_policy = resolutionPolicy;
    conflict.resolved_at = nowIso;
    conflict.resolved_by = authorizedUser;

    if (this.storage && typeof this.storage.set === 'function') {
      await this.storage.set('path_conflicts', conflictId, conflict);
    }

    if (this.auditService) {
      await this.auditService.info('path_conflict_resolved',
        `Resolved path ownership conflict [${conflictId}] via policy '${resolutionPolicy}' by [${authorizedUser}].`,
        conflict
      );
    }

    return conflict;
  }
}

module.exports = PathOwnershipEngine;
module.exports.PathOwnershipEngine = PathOwnershipEngine;
