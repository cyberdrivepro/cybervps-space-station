/**
 * CyberVPS Space Station - NetBox Infrastructure Inventory Adapter
 * Integrates NetBox (Apache-2.0) DCIM/IPAM as the intended source of truth.
 * Reads planned devices, interfaces, IP addresses, and prefixes, and compares
 * them with observed CyberVPS agent telemetry to detect configuration drift.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class NetBoxAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'netbox',
      name: 'NetBox DCIM & IPAM (Infrastructure Inventory)',
      category: 'infrastructure',
      description: 'Infrastructure source of truth for planned devices, sites, prefixes, and IP allocations.',
      version: 'v3.7.0',
      supportedOperations: ['test', 'list_devices', 'list_ip_addresses', 'list_prefixes', 'compare_telemetry'],
      config: {
        api_url: process.env.NETBOX_URL || '',
        api_token: process.env.NETBOX_TOKEN || '',
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
      'Authorization': `Token ${this.config.api_token || ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-SpaceStation-NetBox/1.0'
    };
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'NetBox API URL or API Token not configured.' };
    }

    try {
      const res = await this.httpRequest(`${this.getApiBase()}/api/status/`, {
        method: 'GET',
        headers: this.getHeaders(),
        timeout: 5000
      });

      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        const statusData = res.json || {};
        return {
          success: true,
          status: this.status,
          latency_ms: res.latencyMs,
          details: {
            netbox_version: statusData['netbox-version'] || '3.7+',
            python_version: statusData['python-version'] || '3.x',
            endpoint: this.getApiBase()
          }
        };
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        this.status = ADAPTER_STATUS.UNAUTHORIZED;
        this.lastError = 'Invalid NetBox API Token';
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `NetBox API returned HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      }
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return { success: false, status: this.status, error: `Could not reach NetBox: ${err.message}` };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'get_inventory':
      case 'list_devices': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/dcim/devices/?limit=100`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`NetBox HTTP ${res.statusCode}`);
        const results = (res.json && res.json.results) ? res.json.results : [];
        return results.map(d => ({
          id: d.id,
          name: d.name,
          site: d.site ? d.site.name : null,
          role: d.device_role ? d.device_role.name : (d.role ? d.role.name : null),
          primary_ip: d.primary_ip ? d.primary_ip.address : null,
          status: d.status ? d.status.value : null
        }));
      }

      case 'list_ip_addresses': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/ipam/ip-addresses/?limit=100`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`NetBox HTTP ${res.statusCode}`);
        const results = (res.json && res.json.results) ? res.json.results : [];
        return results.map(i => ({
          id: i.id,
          address: i.address,
          status: i.status ? i.status.value : null,
          assigned_object: i.assigned_object ? i.assigned_object.display : null
        }));
      }

      case 'list_prefixes': {
        const res = await this.httpRequest(`${this.getApiBase()}/api/ipam/prefixes/?limit=50`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (res.statusCode !== 200) throw new Error(`NetBox HTTP ${res.statusCode}`);
        return (res.json && res.json.results) ? res.json.results : [];
      }

      case 'detect_drift':
      case 'compare_telemetry': {
        const observedMachines = params.observed_machines || [];
        const plannedDevices = await this.executeOperation('list_devices');

        const plannedMap = new Map(plannedDevices.map(d => [(d.name || '').toLowerCase(), d]));
        const observedMap = new Map(observedMachines.map(m => [((m.hostname || m.id) || '').toLowerCase(), m]));

        const inSync = [];
        const drift = [];
        const missingInObserved = [];
        const missingInNetBox = [];

        for (const [name, p] of plannedMap) {
          const obs = observedMap.get(name);
          if (!obs) {
            missingInObserved.push({ name, planned: p });
          } else {
            // Check IP match
            const plannedIp = (p.primary_ip || '').split('/')[0];
            const observedIp = obs.virtual_ip || obs.public_ip || obs.ip;
            if (plannedIp && observedIp && plannedIp !== observedIp) {
              drift.push({
                name,
                field: 'ip_address',
                planned: plannedIp,
                observed: observedIp
              });
            } else {
              inSync.push({ name, planned: p, observed: obs });
            }
          }
        }

        for (const [name, obs] of observedMap) {
          if (!plannedMap.has(name)) {
            missingInNetBox.push({ name, observed: obs });
          }
        }

        return {
          total_planned: plannedDevices.length,
          total_observed: observedMachines.length,
          in_sync_count: inSync.length,
          drift_count: drift.length,
          missing_observed_count: missingInObserved.length,
          unregistered_count: missingInNetBox.length,
          drift_items: drift,
          unregistered_nodes: missingInNetBox.slice(0, 20)
        };
      }

      default:
        throw new Error(`Unsupported NetBox operation: ${operation}`);
    }
  }
}

module.exports = { NetBoxAdapter };
