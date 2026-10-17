/**
 * CYBERVPS SPACE STATION - CANARY STAGED ROLLOUT MANAGER
 * Implements safe, progressive OTA deployment across the machine fleet:
 * 1. Single canary target isolation
 * 2. Probe verification & startup probation (30s window)
 * 3. Automatic fleet-wide abort & rollback if canary node fails
 * 4. Staged batch execution with inter-batch health checks
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

class CanaryRolloutManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.db = options.db; // reference to Station memory db
    this.auditService = options.auditService || null;
    this.activeRollout = null;
    this.history = [];
    this.defaultBatchSize = options.defaultBatchSize || 2;
    this.defaultCanaryTimeoutMs = options.defaultCanaryTimeoutMs || 30000;
    this.interBatchDelayMs = options.interBatchDelayMs !== undefined ? options.interBatchDelayMs : 1000;
  }

  /**
   * Start a new canary staged OTA rollout
   */
  startRollout(params = {}) {
    const {
      target_version = '2.2.0',
      force = false,
      target_machine_id = null,
      batch_size = this.defaultBatchSize,
      canary_timeout_ms = this.defaultCanaryTimeoutMs,
      initiated_by = 'admin'
    } = params;

    // Reject if a rollout is actively in-flight
    if (this.activeRollout && ['initiating', 'canary_testing', 'rolling'].includes(this.activeRollout.status)) {
      const err = new Error(`An OTA rollout job [${this.activeRollout.job_id}] is already active in state '${this.activeRollout.status}'. Abort it first before starting a new one.`);
      err.statusCode = 409;
      throw err;
    }

    if (!this.db || !this.db.connectedAgents) {
      const err = new Error('Database connected agents registry not available.');
      err.statusCode = 500;
      throw err;
    }

    // Determine eligible connected machines
    const connectedMids = Array.from(this.db.connectedAgents.keys()).filter(mid => {
      const ws = this.db.connectedAgents.get(mid);
      return ws && (ws.readyState === 1 || ws.readyState === (ws.OPEN || 1));
    });

    if (connectedMids.length === 0) {
      const err = new Error('No agents are currently connected to the control plane for OTA update.');
      err.statusCode = 400;
      throw err;
    }

    let canaryMid = null;
    let pendingMids = [];

    if (target_machine_id) {
      if (!connectedMids.includes(target_machine_id)) {
        const err = new Error(`Target machine '${target_machine_id}' is not currently connected.`);
        err.statusCode = 404;
        throw err;
      }
      canaryMid = target_machine_id;
      pendingMids = [];
    } else {
      // Pick first eligible machine as canary
      canaryMid = connectedMids[0];
      pendingMids = connectedMids.slice(1);
    }

    const jobId = `ota_rollout_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const nowIso = new Date().toISOString();

    const rollout = {
      job_id: jobId,
      target_version,
      force,
      status: 'canary_testing',
      initiated_by,
      started_at: nowIso,
      completed_at: null,
      canary_machine_id: canaryMid,
      canary_status: 'dispatched',
      canary_started_at: nowIso,
      canary_stabilized_at: null,
      batch_size: Math.max(1, parseInt(batch_size, 10) || 2),
      canary_timeout_ms,
      total_eligible_nodes: 1 + pendingMids.length,
      completed_nodes: [],
      failed_nodes: [],
      pending_nodes: pendingMids,
      current_batch: [],
      logs: [
        { timestamp: nowIso, level: 'info', message: `Initiated staged rollout v${target_version}. Canary node: [${canaryMid}]. Pending nodes: ${pendingMids.length}` }
      ]
    };

    this.activeRollout = rollout;

    // Dispatch update to canary agent
    this._dispatchToAgent(canaryMid, target_version, force, 'canary');

    // Arm watchdog timer for canary probation window
    this._armCanaryWatchdog(rollout, canary_timeout_ms);

    if (this.auditService) {
      this.auditService.info('ota_rollout_started', `OTA Canary Rollout [${jobId}] launched for v${target_version}. Canary: [${canaryMid}]`, rollout);
    }

    return this.getStatus();
  }

  /**
   * Arm canary probation watchdog timer
   */
  _armCanaryWatchdog(rollout, timeoutMs) {
    if (this._watchdogTimer) clearTimeout(this._watchdogTimer);
    this._watchdogTimer = setTimeout(() => {
      if (this.activeRollout && this.activeRollout.job_id === rollout.job_id && this.activeRollout.status === 'canary_testing') {
        const timeoutReason = `Canary node [${rollout.canary_machine_id}] failed to stabilize within ${timeoutMs / 1000}s probation window. Rollout automatically aborted to protect fleet integrity.`;
        this._abortRollout(timeoutReason, 'canary_timeout');
      }
    }, timeoutMs);
  }

  /**
   * Helper to dispatch OTA message to an agent
   */
  _dispatchToAgent(machineId, targetVersion, force, phase = 'batch') {
    const ws = this.db.connectedAgents.get(machineId);
    if (!ws || (ws.readyState !== 1 && ws.readyState !== (ws.OPEN || 1))) {
      return false;
    }

    try {
      ws.send(JSON.stringify({
        type: 'OtaUpdate',
        payload: {
          download_url: '/api/v1/ota/download/universal-agent.py',
          target_version: targetVersion,
          force: force,
          rollout_job_id: this.activeRollout ? this.activeRollout.job_id : null,
          phase: phase,
          timestamp: new Date().toISOString()
        }
      }));

      const m = this.db.machines.get(machineId);
      if (m) {
        m.ota_status = phase === 'canary' ? 'canary_testing' : 'updating';
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Handle incoming OtaUpdateEvent from agents
   */
  handleAgentOtaEvent(machineId, payload = {}) {
    if (!this.activeRollout) return;
    const r = this.activeRollout;
    const status = payload.status;
    const nowIso = new Date().toISOString();

    r.logs.push({
      timestamp: nowIso,
      level: status === 'failed' || status === 'failed_rollback' ? 'error' : 'info',
      message: `Agent [${machineId}] reported OTA status: '${status}' (details: ${payload.error || payload.status || 'OK'})`
    });

    // Handle Canary Node Event
    if (machineId === r.canary_machine_id && r.status === 'canary_testing') {
      if (status === 'failed' || status === 'failed_rollback') {
        r.canary_status = 'failed';
        r.failed_nodes.push({ machine_id: machineId, reason: payload.error || 'Canary update failed or rolled back', at: nowIso });
        this._abortRollout(`Canary node [${machineId}] reported update failure: ${payload.error || 'Failed'}. Remaining fleet protected.`, 'canary_failed');
        return;
      }

      if (status === 'stabilized' || status === 'completed') {
        this._onCanarySuccess(machineId);
        return;
      }
    }

    // Handle Batch Node Event
    if (r.status === 'rolling') {
      if (status === 'stabilized' || status === 'completed') {
        if (!r.completed_nodes.find(n => n.machine_id === machineId)) {
          r.completed_nodes.push({ machine_id: machineId, completed_at: nowIso });
        }
        r.current_batch = r.current_batch.filter(id => id !== machineId);
        this._checkBatchCompletion();
      } else if (status === 'failed' || status === 'failed_rollback') {
        if (!r.failed_nodes.find(n => n.machine_id === machineId)) {
          r.failed_nodes.push({ machine_id: machineId, reason: payload.error || 'Batch node update failed', at: nowIso });
        }
        r.current_batch = r.current_batch.filter(id => id !== machineId);
        this._checkBatchCompletion();
      }
    }
  }

  /**
   * Triggered when an agent connects with Auth/Heartbeat
   */
  handleAgentConnected(machineId, agentVersion) {
    if (!this.activeRollout) return;
    const r = this.activeRollout;

    // Check if canary reconnected with target version
    if (r.status === 'canary_testing' && machineId === r.canary_machine_id) {
      if (agentVersion === r.target_version) {
        this._onCanarySuccess(machineId);
        return;
      }
    }

    // Check if batch node reconnected with target version
    if (r.status === 'rolling' && r.current_batch.includes(machineId)) {
      if (agentVersion === r.target_version) {
        const nowIso = new Date().toISOString();
        if (!r.completed_nodes.find(n => n.machine_id === machineId)) {
          r.completed_nodes.push({ machine_id: machineId, completed_at: nowIso });
        }
        r.current_batch = r.current_batch.filter(id => id !== machineId);
        this._checkBatchCompletion();
      }
    }
  }

  /**
   * Called when canary is verified healthy and running target version
   */
  _onCanarySuccess(canaryMid) {
    const r = this.activeRollout;
    if (!r || r.status !== 'canary_testing') return;

    if (this._watchdogTimer) {
      clearTimeout(this._watchdogTimer);
      this._watchdogTimer = null;
    }

    const nowIso = new Date().toISOString();
    r.canary_status = 'passed';
    r.canary_stabilized_at = nowIso;
    r.completed_nodes.push({ machine_id: canaryMid, completed_at: nowIso, role: 'canary' });

    r.logs.push({
      timestamp: nowIso,
      level: 'info',
      message: `✅ Canary node [${canaryMid}] stabilized and verified at v${r.target_version}! Proceeding with fleet batch rollout.`
    });

    if (r.pending_nodes.length === 0) {
      // Single-node rollout or no more nodes in fleet
      r.status = 'completed';
      r.completed_at = nowIso;
      this._archiveRollout();
      return;
    }

    // Transition to fleet rolling stage
    r.status = 'rolling';
    this._dispatchNextBatch();
  }

  /**
   * Dispatch update to the next batch of pending machines
   */
  _dispatchNextBatch() {
    const r = this.activeRollout;
    if (!r || r.status !== 'rolling') return;

    if (r.pending_nodes.length === 0 && r.current_batch.length === 0) {
      r.status = 'completed';
      r.completed_at = new Date().toISOString();
      r.logs.push({
        timestamp: r.completed_at,
        level: 'info',
        message: `🎉 All fleet nodes updated successfully to v${r.target_version}. Rollout complete.`
      });
      this._archiveRollout();
      return;
    }

    const nextBatch = r.pending_nodes.splice(0, r.batch_size);
    r.current_batch = nextBatch;

    r.logs.push({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `Dispatching update to batch of ${nextBatch.length} node(s): [${nextBatch.join(', ')}]`
    });

    for (const mid of nextBatch) {
      const dispatched = this._dispatchToAgent(mid, r.target_version, r.force, 'batch');
      if (!dispatched) {
        // Node disconnected in the meantime
        r.failed_nodes.push({ machine_id: mid, reason: 'Disconnected before dispatch', at: new Date().toISOString() });
        r.current_batch = r.current_batch.filter(id => id !== mid);
      }
    }

    if (r.current_batch.length === 0) {
      this._dispatchNextBatch();
    }
  }

  /**
   * Check if current batch finished so next batch can start
   */
  _checkBatchCompletion() {
    const r = this.activeRollout;
    if (!r || r.status !== 'rolling') return;

    if (r.current_batch.length === 0) {
      if (r.pending_nodes.length === 0) {
        // No more pending nodes in queue, complete immediately
        this._dispatchNextBatch();
      } else {
        const delay = this.interBatchDelayMs !== undefined ? this.interBatchDelayMs : 1000;
        if (delay > 0) {
          setTimeout(() => {
            this._dispatchNextBatch();
          }, delay);
        } else {
          this._dispatchNextBatch();
        }
      }
    }
  }

  /**
   * Abort rollout
   */
  _abortRollout(reason, code = 'manual_abort') {
    const r = this.activeRollout;
    if (!r) return;

    if (this._watchdogTimer) {
      clearTimeout(this._watchdogTimer);
      this._watchdogTimer = null;
    }

    const nowIso = new Date().toISOString();
    r.status = 'aborted';
    r.completed_at = nowIso;
    r.abort_reason = reason;
    r.abort_code = code;

    r.logs.push({
      timestamp: nowIso,
      level: 'warn',
      message: `🚨 Rollout ABORTED: ${reason}`
    });

    // Reset status of pending and batch nodes
    for (const mid of [...r.current_batch, ...r.pending_nodes]) {
      const m = this.db.machines.get(mid);
      if (m && m.ota_status === 'updating') {
        m.ota_status = 'idle';
      }
    }

    if (this.auditService) {
      this.auditService.warn('ota_rollout_aborted', `OTA Rollout [${r.job_id}] aborted: ${reason}`, r);
    }

    this._archiveRollout();
  }

  /**
   * User-initiated abort
   */
  abortActiveRollout(user = 'admin', reason = 'Manually aborted by operator') {
    if (!this.activeRollout || !['canary_testing', 'rolling', 'initiating'].includes(this.activeRollout.status)) {
      const err = new Error('No active rollout job to abort.');
      err.statusCode = 404;
      throw err;
    }
    this._abortRollout(`${reason} (User: ${user})`, 'user_aborted');
    return this.getStatus();
  }

  /**
   * Move active rollout into history
   */
  _archiveRollout() {
    if (this.activeRollout) {
      this.history.unshift({ ...this.activeRollout });
      if (this.history.length > 25) this.history.pop();
    }
  }

  /**
   * Get live status of current or most recent rollout
   */
  getStatus() {
    if (this.activeRollout) {
      const r = this.activeRollout;
      const progressPct = r.total_eligible_nodes > 0 
        ? Math.round(((r.completed_nodes.length + r.failed_nodes.length) / r.total_eligible_nodes) * 100) 
        : 100;

      return {
        has_active_rollout: ['initiating', 'canary_testing', 'rolling'].includes(r.status),
        job_id: r.job_id,
        target_version: r.target_version,
        status: r.status,
        progress_percentage: progressPct,
        canary: {
          machine_id: r.canary_machine_id,
          status: r.canary_status,
          stabilized_at: r.canary_stabilized_at
        },
        counts: {
          total: r.total_eligible_nodes,
          completed: r.completed_nodes.length,
          failed: r.failed_nodes.length,
          pending: r.pending_nodes.length,
          in_flight: r.current_batch.length + (r.status === 'canary_testing' ? 1 : 0)
        },
        completed_nodes: r.completed_nodes,
        failed_nodes: r.failed_nodes,
        abort_reason: r.abort_reason || null,
        started_at: r.started_at,
        completed_at: r.completed_at,
        logs: r.logs.slice(-10)
      };
    }

    return {
      has_active_rollout: false,
      status: 'idle',
      last_rollout: this.history.length > 0 ? this.history[0] : null
    };
  }

  /**
   * Get history of rollouts
   */
  getHistory() {
    return this.history;
  }
}

module.exports = CanaryRolloutManager;
module.exports.CanaryRolloutManager = CanaryRolloutManager;
