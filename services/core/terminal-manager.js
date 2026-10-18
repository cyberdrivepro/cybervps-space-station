/**
 * TerminalManager - Machine-Scoped Web Terminal & PTY Session Coordinator
 * Handles:
 * - Cryptographic HMAC terminal token issuance (5 min TTL)
 * - Session tracking, active WebSocket stream binding
 * - Interactive input/output streaming with ANSI escape sequence support
 * - Window resize negotiation (cols x rows)
 * - Automatic timeout cleanup and resource garbage collection
 */

const crypto = require('crypto');

class TerminalManager {
  constructor(secret, options = {}) {
    const isProd = process.env.NODE_ENV === 'production';
    const resolvedSecret = secret || process.env.CYBERVPS_TERMINAL_SECRET || process.env.PAIRING_KEY || options.secret;
    if (isProd && !resolvedSecret) {
      throw new Error('TerminalManager: Cryptographic token signing secret must be explicitly configured in production.');
    }
    this.secret = resolvedSecret || crypto.randomBytes(32).toString('hex');
    this.tokenTtlMs = options.tokenTtlMs || 5 * 60 * 1000; // 5 mins
    this.sessionInactivityTimeoutMs = options.sessionInactivityTimeoutMs || 30 * 60 * 1000; // 30 mins
    this.activeTokens = new Map(); // token -> { machine_id, expires_at, created_at, used, profile, user_role }
    this.consumedStatelessTokens = new Set(); // token -> consumed timestamp (prevents stateless replay)
    this.activeSessions = new Map(); // session_id -> { machine_id, socket, agent_ws, last_activity, cols, rows }
  }

  /**
   * Issues a short-lived machine-scoped terminal token.
   */
  issueToken(machineId, userRole = 'operator', profile = 'auto') {
    if (!machineId) {
      throw new Error('machine_id is required to issue terminal token');
    }

    const expiresAt = Date.now() + this.tokenTtlMs;
    const expHex = expiresAt.toString(16);
    const nonce = crypto.randomBytes(8).toString('hex');
    const signature = crypto.createHmac('sha256', this.secret)
      .update(`term:${machineId}:${profile}:${expHex}:${nonce}`)
      .digest('hex')
      .slice(0, 24);

    const token = `cvps_term_${machineId}_${expHex}_${nonce}_${signature}`;
    this.activeTokens.set(token, {
      machine_id: machineId,
      user_role: userRole,
      profile: profile || 'auto',
      created_at: Date.now(),
      expires_at: expiresAt,
      used: false
    });

    return {
      token,
      machine_id: machineId,
      profile: profile || 'auto',
      expires_at: new Date(expiresAt).toISOString()
    };
  }

  /**
   * Validates and consumes a terminal token for WebSocket session upgrade.
   */
  validateAndConsumeToken(token, expectedMachineId = null) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: 'missing_token' };
    }

    // Check replay of consumed stateless tokens
    if (this.consumedStatelessTokens.has(token)) {
      return { valid: false, reason: 'token_already_consumed' };
    }

    const entry = this.activeTokens.get(token);
    if (!entry) {
      // Check stateless signature with replay guard
      const res = this._validateStatelessToken(token);
      if (res.valid) {
        if (expectedMachineId && res.machine_id !== expectedMachineId) {
          return { valid: false, reason: 'machine_mismatch' };
        }
        this.consumedStatelessTokens.add(token);
      }
      return res;
    }

    if (entry.used) {
      return { valid: false, reason: 'token_already_consumed' };
    }

    if (Date.now() > entry.expires_at) {
      this.activeTokens.delete(token);
      return { valid: false, reason: 'token_expired' };
    }

    if (expectedMachineId && entry.machine_id !== expectedMachineId) {
      return { valid: false, reason: 'machine_mismatch' };
    }

    entry.used = true;
    this.activeTokens.delete(token); // Single-use consumption
    return { valid: true, machine_id: entry.machine_id, user_role: entry.user_role, profile: entry.profile };
  }

  /**
   * Registers an active terminal session between browser and host agent.
   */
  registerSession(sessionId, machineId, clientWs, agentWs = null) {
    const session = {
      id: sessionId,
      machine_id: machineId,
      client_ws: clientWs,
      agent_ws: agentWs,
      cols: 100,
      rows: 30,
      created_at: Date.now(),
      last_activity: Date.now()
    };
    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Routes user keystrokes / input to agent PTY.
   */
  handleClientInput(sessionId, inputData) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    session.last_activity = Date.now();
    if (session.agent_ws && session.agent_ws.readyState === 1) { // 1 = OPEN
      session.agent_ws.send(JSON.stringify({
        type: 'TerminalInput',
        payload: {
          session_id: sessionId,
          data: inputData
        }
      }));
      return true;
    }
    return false;
  }

  /**
   * Routes PTY terminal output from agent back to browser WebSocket.
   */
  handleAgentOutput(sessionId, outputData) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    session.last_activity = Date.now();
    if (session.client_ws && session.client_ws.readyState === 1) {
      session.client_ws.send(JSON.stringify({
        type: 'output',
        session_id: sessionId,
        data: outputData
      }));
      return true;
    }
    return false;
  }

  /**
   * Resizes terminal dimensions (cols x rows) across PTY.
   */
  resizeTerminal(sessionId, cols, rows) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    session.cols = parseInt(cols, 10) || 100;
    session.rows = parseInt(rows, 10) || 30;
    session.last_activity = Date.now();

    if (session.agent_ws && session.agent_ws.readyState === 1) {
      session.agent_ws.send(JSON.stringify({
        type: 'TerminalResize',
        payload: {
          session_id: sessionId,
          cols: session.cols,
          rows: session.rows
        }
      }));
      return true;
    }
    return false;
  }

  /**
   * Cleans up and closes an active terminal session.
   */
  closeSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    if (session.agent_ws && session.agent_ws.readyState === 1) {
      try {
        session.agent_ws.send(JSON.stringify({
          type: 'TerminalClose',
          payload: { session_id: sessionId }
        }));
      } catch (_) {}
    }

    if (session.client_ws) {
      try { session.client_ws.close(1000, 'Session closed'); } catch (_) {}
    }

    this.activeSessions.delete(sessionId);
    return true;
  }

  _validateStatelessToken(token) {
    if (!token.startsWith('cvps_term_')) return { valid: false, reason: 'invalid_prefix' };
    const parts = token.slice(10).split('_');
    if (parts.length < 4) return { valid: false, reason: 'malformed_token' };

    const signature = parts[parts.length - 1];
    const nonce = parts[parts.length - 2];
    const expHex = parts[parts.length - 3];
    const machineId = parts.slice(0, parts.length - 3).join('_');

    const expiresAt = parseInt(expHex, 16);
    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return { valid: false, reason: 'token_expired' };
    }

    const expectedSigWithProfile = (profile) => crypto.createHmac('sha256', this.secret)
      .update(`term:${machineId}:${profile}:${expHex}:${nonce}`)
      .digest('hex')
      .slice(0, 24);

    const legacySig = crypto.createHmac('sha256', this.secret)
      .update(`term:${machineId}:${expHex}:${nonce}`)
      .digest('hex')
      .slice(0, 24);

    const sigBuf = Buffer.from(signature, 'utf8');
    for (const cand of [legacySig, expectedSigWithProfile('auto'), expectedSigWithProfile('standard'), expectedSigWithProfile('privileged')]) {
      const candBuf = Buffer.from(cand, 'utf8');
      if (sigBuf.length === candBuf.length && crypto.timingSafeEqual(sigBuf, candBuf)) {
        return { valid: true, machine_id: machineId, user_role: 'operator', profile: 'auto' };
      }
    }

    return { valid: false, reason: 'invalid_signature' };
  }
}

module.exports = { TerminalManager };
