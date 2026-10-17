/**
 * CYBERVPS SPACE STATION - ROLE-BASED AUTHENTICATION & ACCESS GUARD
 * Enforces role boundaries: Admin, Operator (Pairing Key), Agent (Node Token), Public
 */

const crypto = require('crypto');

class AuthGuard {
  constructor(options = {}) {
    const isProd = process.env.NODE_ENV === 'production';
    this.adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD || (isProd ? null : 'cybervps_admin_2026');
    this.pairingKey = options.pairingKey || process.env.PAIRING_KEY || (isProd ? null : 'cybervps_pair_station_2026');
    this.enrollmentToken = options.enrollmentToken || process.env.ENROLLMENT_TOKEN || (isProd ? null : 'cvps_enroll_master_token');
    this.auditService = options.auditService || null;
    this.sessions = new Map();
  }

  /**
   * Timing-safe string comparison to protect against timing attacks
   */
  static safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      // Execute dummy comparison to maintain constant time
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Extract credentials from request headers or query params
   */
  extractCredentials(req) {
    const headers = req.headers || {};
    const url = req.url || '';
    const query = req.query || {};

    let pairingKey = headers['x-cvps-pairing-key'] || query.pairing_key || null;
    let sessionToken = headers['x-cvps-session-token'] || query.session_token || null;
    let nodeToken = headers['x-cvps-node-token'] || query.node_token || null;
    let authHeader = headers['authorization'] || '';

    if (authHeader.startsWith('Bearer ')) {
      const bearer = authHeader.substring(7).trim();
      if (bearer.startsWith('cvps_node_') || bearer.startsWith('cvps_boot_')) {
        nodeToken = bearer;
      } else if (bearer.startsWith('cvps_pair_')) {
        pairingKey = bearer;
      } else {
        sessionToken = bearer;
      }
    }

    return { pairingKey, sessionToken, nodeToken, authHeader };
  }

  /**
   * Authenticate request and resolve role
   */
  authenticate(req) {
    const { pairingKey, sessionToken, nodeToken } = this.extractCredentials(req);

    // 1. Check Session Token
    if (sessionToken && this.sessions.has(sessionToken)) {
      const sess = this.sessions.get(sessionToken);
      if (sess.expires_at > Date.now()) {
        return { authenticated: true, role: sess.role || 'operator', user: sess.user || 'operator' };
      }
      this.sessions.delete(sessionToken);
    }

    // 2. Reject Obsolete Master Token used as pairing key
    if (pairingKey && AuthGuard.safeCompare(pairingKey, this.enrollmentToken)) {
      return {
        authenticated: false,
        status: 401,
        reason: 'Obsolete master token cannot be used for dashboard access. Please use your instance pairing key'
      };
    }

    // 3. Reject Agent Enrollment Token attempting operator access
    if (nodeToken && (AuthGuard.safeCompare(nodeToken, this.enrollmentToken) || nodeToken.startsWith('cvps_node_'))) {
      // Valid for agent role, but blocked for operator/admin endpoints
      return { authenticated: true, role: 'agent', token: nodeToken };
    }

    // 4. Validate Instance Pairing Key
    if (pairingKey && AuthGuard.safeCompare(pairingKey, this.pairingKey)) {
      return { authenticated: true, role: 'operator', user: 'operator' };
    }

    return { authenticated: false, status: 401, reason: 'Invalid instance pairing key or session token' };
  }

  /**
   * Middleware requiring Operator or Admin role
   */
  requireOperator() {
    return (req, res, next) => {
      const auth = this.authenticate(req);
      if (!auth.authenticated) {
        if (this.auditService) {
          this.auditService.warn('unauthorized_api_access', `Access denied for ${req.method} ${req.url}: ${auth.reason}`);
        }
        res.writeHead(auth.status || 401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: auth.reason }));
      }

      if (auth.role === 'agent') {
        if (this.auditService) {
          this.auditService.warn('unauthorized_api_access', `Access denied for ${req.method} ${req.url}: Forbidden: Agent enrollment token cannot be used for administrative or client operations`);
        }
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Forbidden: Agent enrollment token cannot be used for administrative or client operations' }));
      }

      req.user = auth;
      next();
    };
  }

  /**
   * Middleware requiring Admin role
   */
  requireAdmin() {
    return (req, res, next) => {
      const auth = this.authenticate(req);
      if (!auth.authenticated || auth.role !== 'admin') {
        if (this.auditService) {
          this.auditService.warn('unauthorized_admin_access', `Admin access denied for ${req.method} ${req.url}`);
        }
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Forbidden: Administrator privileges required' }));
      }
      req.user = auth;
      next();
    };
  }
}

module.exports = AuthGuard;
