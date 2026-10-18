/**
 * CyberVPS Space Station - Headscale Mesh Adapter
 * Integrates Headscale (open-source self-hosted Tailscale control plane).
 * Provides peer node inventory, pre-auth key generation, and route discovery.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class HeadscaleAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'headscale',
      name: 'Headscale (Self-Hosted Tailscale Control Plane)',
      category: 'networking',
      description: 'Open-source, self-hosted implementation of the Tailscale coordination server.',
      version: '0.22.3',
      supportedOperations: ['test', 'list_nodes', 'create_preauthkey', 'get_routes'],
      config: {
        api_url: process.env.HEADSCALE_API_URL || 'http://localhost:8080',
        api_key: process.env.HEADSCALE_API_KEY || '',
        user: process.env.HEADSCALE_USER || 'cybervps',
        ...config
      }
    });
  }

  isConfigured() {
    return Boolean(this.config.api_url && this.config.api_key);
  }

  getApiBase() {
    let url = (this.config.api_url || 'http://localhost:8080').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url;
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.config.api_key || ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-SpaceStation-Headscale/1.0'
    };
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'Headscale API URL or API Key not configured.' };
    }

    try {
      const res = await this.httpRequest(`${this.getApiBase()}/api/v1/node`, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: 5000
      });

      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        const nodes = (res.json && res.json.nodes) ? res.json.nodes : [];
        return {
          success: true,
          status: this.status,
          latency_ms: res.latencyMs,
          details: {
            node_count: nodes.length,
            api_endpoint: this.getApiBase()
          }
        };
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        this.status = ADAPTER_STATUS.UNAUTHORIZED;
        this.lastError = 'Unauthorized: invalid Headscale API Key';
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `Headscale API returned HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      }
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return { success: false, status: this.status, error: `Connection failed: ${err.message}` };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_nodes': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/node`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`Headscale API error: HTTP ${res.statusCode}`);
        const nodes = (res.json && res.json.nodes) ? res.json.nodes : [];
        return nodes.map(n => ({
          id: n.id,
          name: n.name || n.givenName,
          user: n.user ? n.user.name : n.userId,
          ip_addresses: n.ipAddresses || [],
          last_seen: n.lastSeen,
          online: Boolean(n.online),
          key_expiry: n.expiry
        }));
      }

      case 'create_preauth_key':
      case 'create_preauthkey': {
        const user = params.user || this.config.user || 'cybervps';
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/preauthkey`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: {
            user,
            reusable: Boolean(params.reusable),
            ephemeral: Boolean(params.ephemeral),
            expiration: params.expiration || '24h'
          }
        });
        if (res.statusCode !== 200) throw new Error(`Failed to generate preauthkey: HTTP ${res.statusCode} ${res.body}`);
        return res.json;
      }

      case 'get_routes': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/routes`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`Failed to get routes: HTTP ${res.statusCode}`);
        return (res.json && res.json.routes) ? res.json.routes : [];
      }

      default:
        throw new Error(`Unsupported Headscale operation: ${operation}`);
    }
  }
}

module.exports = { HeadscaleAdapter };
