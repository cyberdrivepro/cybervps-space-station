/**
 * CyberVPS Space Station - Pangolin Access Gateway Adapter
 * Connects to Pangolin access gateway for identity-aware web application exposure.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class PangolinAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'pangolin',
      name: 'Pangolin Access Gateway',
      category: 'tunnels',
      description: 'Self-hosted identity-aware reverse access gateway and tunnel controller.',
      version: '0.1.0',
      supportedOperations: ['test', 'list_targets', 'create_target', 'delete_target'],
      config: {
        api_url: process.env.PANGOLIN_API_URL || '',
        api_key: process.env.PANGOLIN_API_KEY || '',
        ...config
      }
    });

    this.targets = new Map();
  }

  isConfigured() {
    return Boolean(this.config.api_url && this.config.api_key);
  }

  getApiBase() {
    let url = (this.config.api_url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.config.api_key || ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-Pangolin-Adapter/1.0'
    };
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'Pangolin API URL or API Key not configured.' };
    }

    try {
      const res = await this.httpRequest(`${this.getApiBase()}/api/v1/targets`, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: 5000
      });

      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        return {
          success: true,
          status: this.status,
          latency_ms: res.latencyMs,
          details: { endpoint: this.getApiBase() }
        };
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        this.status = ADAPTER_STATUS.UNAUTHORIZED;
        this.lastError = 'Invalid Pangolin API key';
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `Pangolin returned HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      }
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return { success: false, status: this.status, error: `Pangolin unreachable: ${err.message}` };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_targets': {
        if (!this.isConfigured()) return Array.from(this.targets.values());
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/targets`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`Pangolin HTTP ${res.statusCode}`);
        return Array.isArray(res.json) ? res.json : Array.from(this.targets.values());
      }

      case 'create_target': {
        const { domain, internal_target } = params;
        if (!domain || !internal_target) throw new Error('domain and internal_target are required');
        const target = {
          id: `target_${Date.now()}`,
          domain,
          internal_target,
          created_at: new Date().toISOString()
        };
        this.targets.set(target.id, target);
        return target;
      }

      case 'delete_target': {
        const { target_id } = params;
        const deleted = this.targets.delete(target_id);
        return { success: deleted, target_id };
      }

      default:
        throw new Error(`Unsupported Pangolin operation: ${operation}`);
    }
  }
}

module.exports = { PangolinAdapter };
