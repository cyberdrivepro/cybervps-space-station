/**
 * CyberVPS Space Station - Uptime Kuma Monitoring Adapter
 * Integrates Uptime Kuma (MIT) for service reachability, tunnel health,
 * and endpoint status checks.
 * Critical rule: Uptime Kuma does NOT replace authoritative agent heartbeats.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class UptimeKumaAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'uptimekuma',
      name: 'Uptime Kuma Service Reachability',
      category: 'observability',
      description: 'Self-hosted monitoring tool for HTTP, TCP, ping, and DNS status verification.',
      version: '1.23.13',
      supportedOperations: ['test', 'list_monitors', 'get_monitors', 'get_heartbeats', 'get_health', 'get_status_page'],
      config: {
        server_url: process.env.UPTIME_KUMA_URL || '',
        api_token: process.env.UPTIME_KUMA_TOKEN || '',
        ...config
      }
    });
  }

  isConfigured() {
    return Boolean(this.config.server_url || this.config.endpoint);
  }

  getServerBase() {
    let url = (this.config.server_url || this.config.endpoint || '').trim().replace(/\/+$/, '');
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, configured: false, error: 'Uptime Kuma URL not configured' };
    }

    try {
      const res = await this.httpRequest(`${this.getServerBase()}/api/status-page/heartbeat`, { timeout: 4000 });
      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        return { success: true, status: this.status, latency_ms: res.latencyMs, details: { endpoint: this.getServerBase() } };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
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

      case 'get_health': {
        if (!this.isConfigured()) {
          return { configured: false, status: 'unconfigured', healthy: false, message: 'Uptime Kuma is not configured' };
        }
        const testRes = await this.testConnection();
        return { configured: true, ...testRes };
      }

      case 'get_monitors':
      case 'list_monitors': {
        if (!this.isConfigured()) {
          return { configured: false, status: 'unconfigured', monitors: [] };
        }
        const res = await this.httpRequest(`${this.getServerBase()}/api/status-page/heartbeat`);
        if (res.statusCode !== 200) {
          return { configured: true, status: 'degraded', monitors: [] };
        }
        const heartbeatList = (res.json && res.json.heartbeatList) ? res.json.heartbeatList : {};
        const monitors = [];
        for (const [id, list] of Object.entries(heartbeatList)) {
          const lastHb = Array.isArray(list) && list.length > 0 ? list[list.length - 1] : null;
          monitors.push({
            id,
            active: lastHb ? lastHb.status === 1 : false,
            ping: lastHb ? lastHb.ping : null,
            time: lastHb ? lastHb.time : null
          });
        }
        return {
          configured: true,
          status: 'connected',
          monitors,
          raw_heartbeats: heartbeatList
        };
      }

      case 'get_heartbeats':
      case 'get_status_page': {
        if (!this.isConfigured()) {
          return { configured: false, status: 'unconfigured', heartbeatList: {} };
        }
        const res = await this.httpRequest(`${this.getServerBase()}/api/status-page/heartbeat`);
        return res.json || {};
      }

      default:
        throw new Error(`Unsupported Uptime Kuma operation: ${operation}`);
    }
  }
}

module.exports = { UptimeKumaAdapter };
