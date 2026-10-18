/**
 * CyberVPS Space Station - Prometheus & Grafana Alloy Adapter
 * Integrates Prometheus query API for fleet metrics, resource scraping, and telemetry pipelines.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class PrometheusAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'prometheus',
      name: 'Prometheus & Grafana Alloy Telemetry',
      category: 'observability',
      description: 'Metrics collection, PromQL querying, and central telemetry pipeline.',
      version: '2.51.0',
      supportedOperations: ['test', 'query', 'get_targets'],
      config: {
        server_url: process.env.PROMETHEUS_URL || 'http://localhost:9090',
        ...config
      }
    });
  }

  isConfigured() {
    return Boolean(this.config.server_url);
  }

  getServerBase() {
    let url = (this.config.server_url || 'http://localhost:9090').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'Prometheus server URL not configured' };
    }

    try {
      const res = await this.httpRequest(`${this.getServerBase()}/api/v1/targets`, { timeout: 4000 });
      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        const activeTargets = (res.json && res.json.data && res.json.data.activeTargets) ? res.json.data.activeTargets.length : 0;
        return {
          success: true,
          status: this.status,
          latency_ms: res.latencyMs,
          details: { endpoint: this.getServerBase(), active_targets: activeTargets }
        };
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

      case 'query': {
        const q = params.query || 'up';
        const res = await this.httpRequest(`${this.getServerBase()}/api/v1/query?query=${encodeURIComponent(q)}`);
        if (res.statusCode !== 200) throw new Error(`Prometheus HTTP ${res.statusCode}`);
        return (res.json && res.json.data) ? res.json.data.result : [];
      }

      case 'get_targets': {
        const res = await this.httpRequest(`${this.getServerBase()}/api/v1/targets`);
        if (res.statusCode !== 200) throw new Error(`Prometheus HTTP ${res.statusCode}`);
        return (res.json && res.json.data) ? res.json.data : {};
      }

      default:
        throw new Error(`Unsupported Prometheus operation: ${operation}`);
    }
  }
}

module.exports = { PrometheusAdapter };
