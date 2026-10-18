/**
 * CyberVPS Space Station - Wazuh Security & FIM Adapter
 * Integrates Wazuh Manager API for File Integrity Monitoring (FIM / syscheck),
 * security alerts with severity mapping, agent health, and incident timeline.
 * Connects directly to the Obsidian Pillar file protection engine.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class WazuhAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'wazuh',
      name: 'Wazuh SIEM & File Integrity Monitoring (FIM)',
      category: 'security',
      description: 'Open-source security monitoring, endpoint compliance, and file integrity protection.',
      version: '4.8.0',
      supportedOperations: ['test', 'list_agents', 'get_fim_events', 'get_security_alerts', 'get_agent_health'],
      config: {
        api_url: process.env.WAZUH_API_URL || '',
        username: process.env.WAZUH_USER || 'wazuh-wui',
        password: process.env.WAZUH_PASSWORD || '',
        ...config
      }
    });

    this.jwtToken = null;
    this.jwtExpiresAt = 0;
  }

  isConfigured() {
    return Boolean(this.config.api_url && this.config.username && this.config.password);
  }

  getApiBase() {
    let url = (this.config.api_url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  async authenticate() {
    if (this.jwtToken && Date.now() < this.jwtExpiresAt) {
      return this.jwtToken;
    }

    const creds = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    const res = await this.httpRequest(`${this.getApiBase()}/security/user/authenticate`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/json'
      },
      rejectUnauthorized: false
    });

    if (res.statusCode === 200 && res.json && res.json.data && res.json.data.token) {
      this.jwtToken = res.json.data.token;
      this.jwtExpiresAt = Date.now() + 840000; // ~14 mins
      return this.jwtToken;
    } else {
      throw new Error(`Wazuh authentication failed: HTTP ${res.statusCode} ${res.body}`);
    }
  }

  async getAuthHeaders() {
    const token = await this.authenticate();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-SpaceStation-Wazuh/1.0'
    };
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'Wazuh API URL, username, or password not configured.' };
    }

    try {
      const t0 = Date.now();
      const headers = await this.getAuthHeaders();
      const res = await this.httpRequest(`${this.getApiBase()}/`, {
        method: 'GET',
        headers,
        timeout: 5000,
        rejectUnauthorized: false
      });

      const latencyMs = Date.now() - t0;
      this.lastLatencyMs = latencyMs;

      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        const apiData = (res.json && res.json.data) ? res.json.data : {};
        return {
          success: true,
          status: this.status,
          latency_ms: latencyMs,
          details: {
            wazuh_title: apiData.title || 'Wazuh API',
            wazuh_version: apiData.version || '4.8.x',
            endpoint: this.getApiBase()
          }
        };
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        this.status = ADAPTER_STATUS.UNAUTHORIZED;
        this.lastError = 'Wazuh API authorization failed.';
        return { success: false, status: this.status, latency_ms: latencyMs, error: this.lastError };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `Wazuh API returned HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: latencyMs, error: this.lastError };
      }
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return { success: false, status: this.status, error: `Could not reach Wazuh API: ${err.message}` };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_agents': {
        const headers = await this.getAuthHeaders();
        const res = await this.httpRequest(`${this.getApiBase()}/agents?limit=100`, {
          method: 'GET',
          headers,
          rejectUnauthorized: false
        });
        if (res.statusCode !== 200) throw new Error(`Wazuh agents query failed: HTTP ${res.statusCode}`);
        const items = (res.json && res.json.data && res.json.data.affected_items) ? res.json.data.affected_items : [];
        return items.map(a => ({
          agent_id: a.id,
          name: a.name,
          ip: a.ip,
          status: a.status,
          os: a.os ? `${a.os.name} ${a.os.version}` : 'Unknown',
          version: a.version,
          last_keepalive: a.lastKeepAlive
        }));
      }

      case 'get_syscheck_events':
      case 'get_fim_events': {
        const agentId = params.agent_id || '000';
        const headers = await this.getAuthHeaders();
        const res = await this.httpRequest(`${this.getApiBase()}/syscheck/${encodeURIComponent(agentId)}?limit=50`, {
          method: 'GET',
          headers,
          rejectUnauthorized: false
        });
        if (res.statusCode !== 200) throw new Error(`Wazuh syscheck query failed: HTTP ${res.statusCode}`);
        const items = (res.json && res.json.data && res.json.data.affected_items) ? res.json.data.affected_items : [];
        return items.map(f => ({
          file: f.file,
          event_type: f.event || 'modified',
          sha256: f.sha256,
          modification_time: f.date,
          size: f.size,
          permissions: f.perm
        }));
      }

      case 'query_alerts':
      case 'get_security_alerts': {
        // Fetch recent security alerts from manager
        const headers = await this.getAuthHeaders();
        const res = await this.httpRequest(`${this.getApiBase()}/manager/logs?limit=50&category=wazuh-agent`, {
          method: 'GET',
          headers,
          rejectUnauthorized: false
        });
        if (res.statusCode !== 200) return [];
        return (res.json && res.json.data && res.json.data.affected_items) ? res.json.data.affected_items : [];
      }

      case 'get_agent_health': {
        const agentId = params.agent_id;
        if (!agentId) throw new Error('agent_id is required');
        const headers = await this.getAuthHeaders();
        const res = await this.httpRequest(`${this.getApiBase()}/agents?agents_list=${encodeURIComponent(agentId)}`, {
          method: 'GET',
          headers,
          rejectUnauthorized: false
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
        const items = (res.json && res.json.data && res.json.data.affected_items) ? res.json.data.affected_items : [];
        const agent = items[0] || null;
        return {
          agent_id: agentId,
          connected: agent ? (agent.status === 'active') : false,
          agent
        };
      }

      default:
        throw new Error(`Unsupported Wazuh operation: ${operation}`);
    }
  }
}

module.exports = { WazuhAdapter };
