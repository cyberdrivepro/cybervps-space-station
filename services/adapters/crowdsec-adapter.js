/**
 * CyberVPS Space Station - CrowdSec Threat Remediation Adapter
 * Integrates CrowdSec Local API (LAPI) for active attack detection, IP remediation,
 * and reversible ban decisions.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class CrowdSecAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'crowdsec',
      name: 'CrowdSec Threat Detection & IPS',
      category: 'security',
      description: 'Collaborative, open-source security engine analyzing logs and banning aggressive IPs.',
      version: '1.6.0',
      supportedOperations: ['test', 'list_alerts', 'list_decisions', 'apply_decision', 'delete_decision'],
      config: {
        api_url: process.env.CROWDSEC_LAPI_URL || 'http://localhost:8080',
        api_key: process.env.CROWDSEC_API_KEY || '',
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
      'X-Api-Key': this.config.api_key || '',
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-SpaceStation-CrowdSec/1.0'
    };
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'CrowdSec LAPI URL or API Key not configured.' };
    }

    try {
      const res = await this.httpRequest(`${this.getApiBase()}/v1/decisions`, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: 4000
      });

      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        const decisions = Array.isArray(res.json) ? res.json : [];
        return {
          success: true,
          status: this.status,
          latency_ms: res.latencyMs,
          details: {
            active_decisions_count: decisions.length,
            lapi_endpoint: this.getApiBase()
          }
        };
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        this.status = ADAPTER_STATUS.UNAUTHORIZED;
        this.lastError = 'Invalid CrowdSec LAPI key';
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `CrowdSec returned HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      }
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return { success: false, status: this.status, error: `Could not reach CrowdSec: ${err.message}` };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'query_alerts':
      case 'list_alerts': {
        const res = await this.httpRequest(`${this.getApiBase()}/v1/alerts?limit=50`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`CrowdSec HTTP ${res.statusCode}`);
        return Array.isArray(res.json) ? res.json : [];
      }

      case 'list_decisions': {
        const res = await this.httpRequest(`${this.getApiBase()}/v1/decisions`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`CrowdSec HTTP ${res.statusCode}`);
        return Array.isArray(res.json) ? res.json : [];
      }

      case 'add_decision':
      case 'apply_decision': {
        const value = params.value || params.ip;
        const type = params.type || 'ban';
        const duration = params.duration || '4h';
        const reason = params.reason || 'Manual CyberVPS Security Block';
        if (!value) throw new Error('Target value (IP address or range) is required');

        const payload = [{
          origin: 'cscli',
          type,
          scope: 'Ip',
          value,
          duration,
          reason,
          scenario: 'manual/cybervps-operator'
        }];

        const res = await this.httpRequest(`${this.getApiBase()}/v1/decisions`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: payload
        });
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          throw new Error(`Failed to apply CrowdSec decision: HTTP ${res.statusCode}`);
        }
        return { success: true, target: value, type, duration };
      }

      case 'remove_decision':
      case 'delete_decision': {
        const ip = params.ip || params.value;
        if (!ip) throw new Error('IP is required to revoke decision');
        const res = await this.httpRequest(`${this.getApiBase()}/v1/decisions?ip=${encodeURIComponent(ip)}`, {
          method: 'DELETE',
          headers: this.getHeaders()
        });
        return { success: res.statusCode === 200, ip };
      }

      default:
        throw new Error(`Unsupported CrowdSec operation: ${operation}`);
    }
  }
}

module.exports = { CrowdSecAdapter };
