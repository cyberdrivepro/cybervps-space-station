/**
 * CyberVPS Space Station - Beszel Monitoring Adapter
 * Integrates Beszel (MIT) for lightweight server resource metrics and historical graphs.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class BeszelAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'beszel',
      name: 'Beszel Host Resource Monitor',
      category: 'observability',
      description: 'Lightweight server monitoring hub with historical CPU, memory, disk, and network telemetry.',
      version: '0.1.2',
      supportedOperations: ['test', 'get_systems', 'get_system_metrics'],
      config: {
        hub_url: process.env.BESZEL_HUB_URL || '',
        public_key: process.env.BESZEL_KEY || '',
        ...config
      }
    });
  }

  isConfigured() {
    return Boolean(this.config.hub_url);
  }

  getHubBase() {
    let url = (this.config.hub_url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'Beszel Hub URL not configured' };
    }

    try {
      const res = await this.httpRequest(`${this.getHubBase()}/api/health`, { timeout: 4000 });
      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        return { success: true, status: this.status, latency_ms: res.latencyMs, details: { hub_url: this.getHubBase() } };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: `HTTP ${res.statusCode}` };
      }
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

      case 'get_systems': {
        const res = await this.httpRequest(`${this.getHubBase()}/api/systems`);
        if (res.statusCode !== 200) return [];
        return Array.isArray(res.json) ? res.json : [];
      }

      case 'get_system_metrics': {
        const { system_id } = params;
        if (!system_id) throw new Error('system_id is required');
        const res = await this.httpRequest(`${this.getHubBase()}/api/system/${encodeURIComponent(system_id)}/records`);
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
        return res.json;
      }

      default:
        throw new Error(`Unsupported Beszel operation: ${operation}`);
    }
  }
}

module.exports = { BeszelAdapter };
