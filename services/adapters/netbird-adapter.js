/**
 * CyberVPS Space Station - NetBird Mesh Adapter
 * Integrates NetBird WireGuard-based encrypted mesh network management.
 * Provides peer inventory, 100.x.x.x overlay IP allocation, access policies,
 * routes, and setup keys while preserving CyberVPS's native 10.77.0.x mesh as zero-dependency fallback.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class NetBirdAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'netbird',
      name: 'NetBird Encrypted WireGuard Mesh',
      category: 'networking',
      description: 'Peer-to-peer encrypted WireGuard mesh networking with NAT traversal and central management.',
      version: '0.28.0',
      supportedOperations: ['test', 'list_peers', 'get_routes', 'get_policies', 'create_setup_key', 'delete_peer'],
      config: {
        api_url: process.env.NETBIRD_API_URL || 'https://api.netbird.io',
        api_key: process.env.NETBIRD_API_KEY || '',
        ...config
      }
    });
  }

  isConfigured() {
    return Boolean(this.config.api_url && this.config.api_key);
  }

  getApiBase() {
    let url = (this.config.api_url || 'https://api.netbird.io').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.config.api_key || ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-SpaceStation-NetBird/1.0'
    };
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return {
        success: false,
        status: this.status,
        error: 'NetBird API Key or Management URL not configured.'
      };
    }

    try {
      const res = await this.httpRequest(`${this.getApiBase()}/api/peers`, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: 5000
      });

      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        const peers = Array.isArray(res.json) ? res.json : [];
        return {
          success: true,
          status: this.status,
          latency_ms: res.latencyMs,
          details: {
            peer_count: peers.length,
            api_endpoint: this.getApiBase(),
            online_peers: peers.filter(p => p.connected).length
          }
        };
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        this.status = ADAPTER_STATUS.UNAUTHORIZED;
        this.lastError = 'Invalid or expired NetBird API Key (HTTP ' + res.statusCode + ')';
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `NetBird API returned HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      }
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return {
        success: false,
        status: this.status,
        error: `Could not connect to NetBird Management API: ${err.message}`
      };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_peers': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/peers`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) {
          throw new Error(`Failed to list NetBird peers: HTTP ${res.statusCode} ${res.body}`);
        }
        const rawPeers = Array.isArray(res.json) ? res.json : [];
        return rawPeers.map(p => ({
          id: p.id,
          name: p.name || p.hostname,
          ip: p.ip,
          connected: Boolean(p.connected),
          last_seen: p.last_seen,
          os: p.os,
          version: p.version,
          public_key: p.key
        }));
      }

      case 'list_routes':
      case 'get_routes': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/routes`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) {
          throw new Error(`Failed to get routes: HTTP ${res.statusCode}`);
        }
        return Array.isArray(res.json) ? res.json : [];
      }

      case 'get_policies': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/policies`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) {
          throw new Error(`Failed to get policies: HTTP ${res.statusCode}`);
        }
        return Array.isArray(res.json) ? res.json : [];
      }

      case 'create_setup_key': {
        const payload = {
          name: params.name || `CyberVPS-Node-${Date.now()}`,
          type: params.type || 'reusable',
          expires_in: params.expires_in || 86400,
          revoked: false,
          auto_groups: params.groups || ['cybervps-mesh']
        };
        const res = await this.httpRequest(`${this.getApiBase()}/api/setup-keys`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: payload
        });
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          throw new Error(`Failed to create setup key: HTTP ${res.statusCode} ${res.body}`);
        }
        return res.json;
      }

      case 'delete_peer': {
        if (!params.peer_id) throw new Error('peer_id is required');
        const res = await this.httpRequest(`${this.getApiBase()}/api/peers/${encodeURIComponent(params.peer_id)}`, {
          method: 'DELETE',
          headers: this.getHeaders()
        });
        return { success: res.statusCode === 200 || res.statusCode === 204, statusCode: res.statusCode };
      }

      default:
        throw new Error(`Unsupported NetBird operation: ${operation}`);
    }
  }
}

module.exports = { NetBirdAdapter };
