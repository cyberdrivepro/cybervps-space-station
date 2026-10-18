/**
 * CyberVPS Space Station - Apache Guacamole Adapter
 * Integrates Apache Guacamole (Apache-2.0) for browser-based RDP, VNC, and SSH sessions.
 * Manages connection profiles, keeps host credentials on the backend, and mints
 * client tokens for clientless HTML5 canvas streaming.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');
const crypto = require('crypto');

class GuacamoleAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'guacamole',
      name: 'Apache Guacamole (HTML5 RDP / VNC / SSH)',
      category: 'remote_access',
      description: 'Clientless remote desktop gateway supporting RDP, VNC, and SSH via HTML5.',
      version: '1.5.4',
      supportedOperations: ['test', 'list_connections', 'create_connection', 'mint_client_token', 'get_connection_token', 'delete_connection'],
      config: {
        server_url: process.env.GUACAMOLE_URL || '',
        username: process.env.GUACAMOLE_USER || 'guacadmin',
        password: process.env.GUACAMOLE_PASSWORD || '',
        data_source: process.env.GUACAMOLE_DATA_SOURCE || 'default',
        ...config
      }
    });

    this.authToken = null;
    this.tokenExpiresAt = 0;
    this.connectionProfiles = new Map();
  }

  isConfigured() {
    return Boolean(this.config.server_url && this.config.username && this.config.password);
  }

  getServerBase() {
    let url = (this.config.server_url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  async authenticate() {
    if (this.authToken && Date.now() < this.tokenExpiresAt) {
      return this.authToken;
    }

    const res = await this.httpRequest(`${this.getServerBase()}/api/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${encodeURIComponent(this.config.username)}&password=${encodeURIComponent(this.config.password)}`
    });

    if (res.statusCode === 200 && res.json && res.json.authToken) {
      this.authToken = res.json.authToken;
      this.tokenExpiresAt = Date.now() + 300000; // 5 min cache
      return this.authToken;
    } else {
      throw new Error(`Guacamole authentication failed: HTTP ${res.statusCode} ${res.body}`);
    }
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'Guacamole URL, username, or password not configured.' };
    }

    try {
      const t0 = Date.now();
      const token = await this.authenticate();
      const latencyMs = Date.now() - t0;
      this.lastLatencyMs = latencyMs;
      this.status = ADAPTER_STATUS.CONNECTED;
      this.lastSync = new Date().toISOString();
      this.lastError = null;

      return {
        success: true,
        status: this.status,
        latency_ms: latencyMs,
        details: {
          server_url: this.getServerBase(),
          authenticated_user: this.config.username,
          data_source: this.config.data_source
        }
      };
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return { success: false, status: this.status, error: err.message };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_connections': {
        const token = await this.authenticate();
        const ds = this.config.data_source || 'default';
        const res = await this.httpRequest(`${this.getServerBase()}/api/session/data/${encodeURIComponent(ds)}/connections?token=${token}`, {
          method: 'GET'
        });
        if (res.statusCode !== 200) throw new Error(`Guacamole list connections failed: HTTP ${res.statusCode}`);
        const conns = res.json || {};
        return Object.entries(conns).map(([id, c]) => ({
          identifier: id,
          name: c.name,
          protocol: c.protocol,
          active_connections: c.activeConnections || 0,
          last_active: c.lastActive
        }));
      }

      case 'create_connection': {
        const { name, protocol = 'rdp', hostname, port = 3389, username, password } = params;
        if (!name || !hostname) throw new Error('name and hostname are required');

        const token = await this.authenticate();
        const ds = this.config.data_source || 'default';

        const payload = {
          name,
          protocol,
          parameters: {
            hostname,
            port: String(port),
            ignore_cert: 'true',
            'enable-wallpaper': 'false',
            'enable-theming': 'false',
            'enable-font-smoothing': 'true',
            ...(username ? { username } : {}),
            ...(password ? { password } : {})
          }
        };

        const res = await this.httpRequest(`${this.getServerBase()}/api/session/data/${encodeURIComponent(ds)}/connections?token=${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });

        if (res.statusCode !== 200 && res.statusCode !== 201) {
          throw new Error(`Failed to create Guacamole connection: HTTP ${res.statusCode} ${res.body}`);
        }

        const identifier = (res.json && res.json.identifier) || `conn_${Date.now()}`;
        return {
          identifier,
          name,
          protocol,
          hostname,
          port
        };
      }

      case 'get_connection_token':
      case 'mint_client_token': {
        if (!this.isConfigured()) {
          return {
            success: false,
            configured: false,
            status: 'unconfigured',
            error: 'Apache Guacamole server URL, username, or password is not configured. Please configure Guacamole in the Open-Source Hub.'
          };
        }

        const connId = params.connection_id || params.machine_id;
        if (!connId) throw new Error('connection_id or machine_id is required');

        const token = await this.authenticate();
        const clientUrl = `${this.getServerBase()}/#/client/${encodeURIComponent(connId)}?token=${token}`;
        return {
          success: true,
          configured: true,
          connection_id: connId,
          machine_id: params.machine_id || connId,
          token,
          client_url: clientUrl,
          expires_in: 300
        };
      }

      default:
        throw new Error(`Unsupported Guacamole operation: ${operation}`);
    }
  }
}

module.exports = { GuacamoleAdapter };
