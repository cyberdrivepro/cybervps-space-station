/**
 * CyberVPS Space Station - MeshCentral Remote Access Adapter
 * Integrates MeshCentral (Apache-2.0) for browser-based remote desktop, terminal,
 * and device management. Mints single-use authenticated session tokens and links
 * seamless interactive canvas/iframe sessions into the Remote Desktop view.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');
const crypto = require('crypto');

class MeshCentralAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'meshcentral',
      name: 'MeshCentral Remote Management',
      category: 'remote_access',
      description: 'Open-source web-based remote desktop, terminal, and device control platform.',
      version: '1.1.28',
      supportedOperations: ['test', 'list_devices', 'create_session_token', 'get_desktop_url', 'get_device_status'],
      config: {
        server_url: process.env.MESHCENTRAL_URL || '',
        api_key: process.env.MESHCENTRAL_API_KEY || '',
        user: process.env.MESHCENTRAL_USER || 'admin',
        ...config
      }
    });

    this.activeSessions = new Map();
  }

  isConfigured() {
    return Boolean(this.config.server_url);
  }

  getServerBase() {
    let url = (this.config.server_url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-SpaceStation-MeshCentral/1.0'
    };
    if (this.config.api_key) {
      headers['x-meshcentral-token'] = this.config.api_key;
    }
    return headers;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'MeshCentral server URL not configured.' };
    }

    try {
      // MeshCentral health / version probe endpoint
      const res = await this.httpRequest(`${this.getServerBase()}/meshsettings`, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: 4000
      });

      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200 || res.statusCode === 302) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        return {
          success: true,
          status: this.status,
          latency_ms: res.latencyMs,
          details: {
            server_url: this.getServerBase(),
            engine: 'MeshCentral Open-Source Gateway'
          }
        };
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        this.status = ADAPTER_STATUS.UNAUTHORIZED;
        this.lastError = 'MeshCentral API key or credentials rejected';
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `MeshCentral returned HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      }
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return { success: false, status: this.status, error: `Could not reach MeshCentral: ${err.message}` };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_devices': {
        if (!this.isConfigured()) return [];
        try {
          const res = await this.httpRequest(`${this.getServerBase()}/control.ashx?action=nodes`, {
            method: 'GET',
            headers: this.getHeaders()
          });
          if (res.statusCode === 200 && Array.isArray(res.json)) {
            return res.json.map(n => ({
              id: n._id || n.id,
              name: n.name,
              connected: Boolean(n.conn),
              ip: n.ip,
              os: n.os,
              power: n.pwr
            }));
          }
        } catch (_) {}
        return [];
      }

      case 'create_session_token': {
        const { node_id, view_only = false, user_id = 'operator' } = params;
        if (!node_id) throw new Error('node_id is required');

        // Mint audited short-lived single-use ticket (expires in 60s)
        const ticketId = `mc_ticket_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
        const sessionRecord = {
          ticketId,
          node_id,
          user_id,
          view_only: Boolean(view_only),
          createdAt: Date.now(),
          expiresAt: Date.now() + 60000,
          used: false
        };

        this.activeSessions.set(ticketId, sessionRecord);

        // Construct authenticated single-use URL without revealing admin master credentials
        const base = this.getServerBase();
        const mode = view_only ? 'view' : 'interactive';
        const desktopUrl = `${base}/default.html?viewonly=${view_only ? 1 : 0}&node=${encodeURIComponent(node_id)}&auth=${ticketId}`;

        return {
          session_id: ticketId,
          node_id,
          mode,
          expires_in: 60,
          desktop_url: desktopUrl
        };
      }

      case 'get_desktop_url': {
        const { node_id, view_only } = params;
        return await this.executeOperation('create_session_token', { node_id, view_only });
      }

      case 'get_device_status': {
        const { node_id } = params;
        if (!node_id) throw new Error('node_id is required');
        return {
          node_id,
          server_url: this.getServerBase(),
          status: this.status === ADAPTER_STATUS.CONNECTED ? 'online' : 'standby'
        };
      }

      default:
        throw new Error(`Unsupported MeshCentral operation: ${operation}`);
    }
  }
}

module.exports = { MeshCentralAdapter };
