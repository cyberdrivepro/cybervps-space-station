/**
 * CyberVPS Space Station - Coolify PaaS Adapter
 * Integrates Coolify (Apache-2.0) self-hosted PaaS.
 * Provides application listings, deployment triggers, real-time build logs,
 * resource statistics, and deployment job tracking.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class CoolifyAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'coolify',
      name: 'Coolify Self-Hosted PaaS',
      category: 'paas',
      description: 'Self-hosted Heroku/Netlify alternative for automated Git-based application and container deployment.',
      version: 'v4.0.0',
      supportedOperations: ['test', 'list_projects', 'list_applications', 'deploy_application', 'get_deployment_status', 'get_deployment_logs', 'get_servers'],
      config: {
        api_url: process.env.COOLIFY_API_URL || '',
        api_token: process.env.COOLIFY_API_TOKEN || '',
        ...config
      }
    });
  }

  isConfigured() {
    return Boolean(this.config.api_url && this.config.api_token);
  }

  getApiBase() {
    let url = (this.config.api_url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.config.api_token || ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-SpaceStation-Coolify/1.0'
    };
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'Coolify API URL or Bearer Token not configured.' };
    }

    try {
      const res = await this.httpRequest(`${this.getApiBase()}/api/v1/servers`, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: 5000
      });

      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        const servers = Array.isArray(res.json) ? res.json : [];
        return {
          success: true,
          status: this.status,
          latency_ms: res.latencyMs,
          details: {
            server_count: servers.length,
            api_endpoint: this.getApiBase()
          }
        };
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        this.status = ADAPTER_STATUS.UNAUTHORIZED;
        this.lastError = 'Unauthorized: Coolify API token invalid or expired';
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `Coolify returned HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      }
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return { success: false, status: this.status, error: `Could not reach Coolify: ${err.message}` };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_projects': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/projects`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`Coolify HTTP ${res.statusCode}: ${res.body}`);
        const projects = Array.isArray(res.json) ? res.json : [];
        return projects.map(p => ({
          uuid: p.uuid,
          name: p.name,
          description: p.description,
          environments: (p.environments || []).map(e => ({ name: e.name, uuid: e.uuid }))
        }));
      }

      case 'list_applications': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/applications`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`Coolify HTTP ${res.statusCode}: ${res.body}`);
        const apps = Array.isArray(res.json) ? res.json : [];
        return apps.map(a => ({
          uuid: a.uuid,
          name: a.name,
          fqdn: a.fqdn,
          status: a.status,
          build_pack: a.build_pack,
          git_repository: a.git_repository,
          git_branch: a.git_branch,
          updated_at: a.updated_at
        }));
      }

      case 'deploy_application': {
        const app_uuid = params.app_uuid || params.application_uuid || params.uuid;
        const force_rebuild = Boolean(params.force_rebuild);
        if (!app_uuid) throw new Error('app_uuid is required');

        if (jobContext) jobContext.appendLog('info', `Triggering deployment for application [${app_uuid}]...`);
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/deploy`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: {
            uuid: app_uuid,
            force_rebuild: Boolean(force_rebuild)
          }
        });

        if (res.statusCode !== 200 && res.statusCode !== 201) {
          throw new Error(`Deployment dispatch failed: HTTP ${res.statusCode} ${res.body}`);
        }

        const deployData = res.json || {};
        if (jobContext) {
          jobContext.updateProgress(30, 'Build job queued on Coolify server');
          jobContext.appendLog('info', `Deployment UUID: ${deployData.deployment_uuid || 'queued'}`);
        }

        return {
          success: true,
          app_uuid,
          deployment_uuid: deployData.deployment_uuid || null,
          message: 'Deployment triggered successfully'
        };
      }

      case 'get_deployment_status': {
        const deployment_uuid = params.deployment_uuid || params.uuid;
        if (!deployment_uuid) throw new Error('deployment_uuid is required');
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/deployments/${encodeURIComponent(deployment_uuid)}`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
        return res.json;
      }

      case 'get_build_logs':
      case 'get_deployment_logs': {
        const deployment_uuid = params.deployment_uuid || params.uuid;
        if (!deployment_uuid) throw new Error('deployment_uuid is required');
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/deployments/${encodeURIComponent(deployment_uuid)}/logs`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
        return (res.json && res.json.logs) ? res.json.logs : res.body;
      }

      case 'get_servers': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/v1/servers`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
        return Array.isArray(res.json) ? res.json : [];
      }

      default:
        throw new Error(`Unsupported Coolify operation: ${operation}`);
    }
  }
}

module.exports = { CoolifyAdapter };
