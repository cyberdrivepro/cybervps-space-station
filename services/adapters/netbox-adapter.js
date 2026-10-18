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
      supportedOperations: ['test', 'list_devices', 'list_ip_addresses', 'list_prefixes', 'compare_telemetry', 'detect_drift', 'sync_device', 'get_inventory'],
      config: {
        api_url: process.env.NETBOX_URL || '',
        api_token: process.env.NETBOX_TOKEN || '',
        ...config
      }
    });
  }

  isConfigured() {
    const url = this.config.api_url || this.config.endpoint;
    const token = this.config.api_token || this.config.token;
    return Boolean(url && token);
  }

  getApiBase() {
    let url = (this.config.api_url || this.config.endpoint || '').trim().replace(/\/+$/, '');
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  getHeaders() {
    const token = this.config.api_token || this.config.token || '';
    return {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-SpaceStation-NetBox/1.0'
    };
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, configured: false, error: 'NetBox API URL or API Token not configured.' };
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
        if (!this.isConfigured()) {
          throw new Error('NetBox is not configured');
        }
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
        if (!this.isConfigured()) {
          throw new Error('NetBox is not configured');
        }
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
        if (!this.isConfigured()) {
          throw new Error('NetBox is not configured');
        }
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
        let plannedDevices = [];
        try {
          plannedDevices = await this.executeOperation('list_devices');
        } catch (err) {
          if (!this.isConfigured()) {
            return {
              success: false,
              configured: false,
              status: ADAPTER_STATUS.UNCONFIGURED,
              message: 'NetBox DCIM adapter is currently not configured or in standby mode.',
              total_planned: 0,
              total_observed: observedMachines.length,
              in_sync_count: 0,
              drift_count: 0,
              missing_observed_count: 0,
              unregistered_count: observedMachines.length,
              drift_items: [],
              in_sync_items: [],
              unregistered_nodes: observedMachines.map(m => ({
                name: m.hostname || m.id,
                observed: m
              })),
              all_items: observedMachines.map(m => ({
                name: m.hostname || m.id,
                role: m.role || 'Edge VPS',
                ip: m.virtual_ip || m.public_ip || m.ip || '10.77.0.x',
                drift: true,
                field: 'unmanaged_device',
                observed: m
              }))
            };
          }
          throw err;
        }

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
                name: obs.hostname || p.name || name,
                role: p.role || 'Edge VPS',
                ip: observedIp,
                planned_ip: plannedIp,
                drift: true,
                field: 'ip_address',
                planned: plannedIp,
                observed: observedIp
              });
            } else {
              inSync.push({
                name: obs.hostname || p.name || name,
                role: p.role || 'Edge VPS',
                ip: observedIp || plannedIp,
                drift: false,
                field: null,
                planned: p,
                observed: obs
              });
            }
          }
        }

        for (const [name, obs] of observedMap) {
          if (!plannedMap.has(name)) {
            missingInNetBox.push({
              name: obs.hostname || obs.id || name,
              role: obs.role || 'Edge VPS',
              ip: obs.virtual_ip || obs.public_ip || obs.ip || '10.77.0.x',
              drift: true,
              field: 'unmanaged_device',
              observed: obs
            });
          }
        }

        return {
          success: true,
          configured: true,
          status: this.status,
          total_planned: plannedDevices.length,
          total_observed: observedMachines.length,
          in_sync_count: inSync.length,
          drift_count: drift.length,
          missing_observed_count: missingInObserved.length,
          unregistered_count: missingInNetBox.length,
          drift_items: drift,
          in_sync_items: inSync,
          unregistered_nodes: missingInNetBox.slice(0, 50),
          all_items: [...drift, ...missingInNetBox, ...inSync]
        };
      }

      case 'sync_device': {
        if (!this.isConfigured()) {
          return {
            success: false,
            configured: false,
            status: ADAPTER_STATUS.UNCONFIGURED,
            error: 'NetBox DCIM adapter is not configured. Please configure NetBox URL and API Token.'
          };
        }

        const name = params.name || params.hostname || params.id;
        if (!name) throw new Error('Machine name or hostname is required');
        const roleName = params.role || 'server';
        const statusVal = params.status || 'active';
        const virtualIp = params.virtual_ip || params.ip;
        const dryRun = Boolean(params.dry_run);

        // 1. Check if device exists in NetBox
        const searchRes = await this.httpRequest(`${this.getApiBase()}/api/dcim/devices/?name=${encodeURIComponent(name)}`, {
          method: 'GET',
          headers: this.getHeaders()
        });
        if (searchRes.statusCode !== 200) {
          throw new Error(`NetBox device lookup failed: HTTP ${searchRes.statusCode}`);
        }
        const existingDevices = (searchRes.json && searchRes.json.results) ? searchRes.json.results : [];
        const existing = existingDevices.length > 0 ? existingDevices[0] : null;

        if (dryRun) {
          return {
            success: true,
            dry_run: true,
            action: existing ? 'update' : 'create',
            device_name: name,
            existing_id: existing ? existing.id : null,
            target_role: roleName,
            target_status: statusVal,
            target_ip: virtualIp || null,
            message: existing
              ? `Dry-run plan: Update existing NetBox device '${name}' (ID: ${existing.id})`
              : `Dry-run plan: Provision new NetBox device '${name}' with role '${roleName}'`
          };
        }

        // 2. Perform write
        let deviceResult = null;
        if (existing) {
          const patchRes = await this.httpRequest(`${this.getApiBase()}/api/dcim/devices/${existing.id}/`, {
            method: 'PATCH',
            headers: this.getHeaders(),
            body: JSON.stringify({ status: statusVal })
          });
          if (patchRes.statusCode >= 200 && patchRes.statusCode < 300) {
            deviceResult = patchRes.json;
          } else {
            throw new Error(`Failed to update NetBox device '${name}': HTTP ${patchRes.statusCode}`);
          }
        } else {
          let siteId = params.site_id;
          let roleId = params.role_id;
          let deviceTypeId = params.device_type_id;

          if (!siteId) {
            const sRes = await this.httpRequest(`${this.getApiBase()}/api/dcim/sites/?limit=1`, { headers: this.getHeaders() });
            if (sRes.statusCode === 200 && sRes.json?.results?.length > 0) siteId = sRes.json.results[0].id;
          }
          if (!roleId) {
            const rRes = await this.httpRequest(`${this.getApiBase()}/api/dcim/device-roles/?limit=1`, { headers: this.getHeaders() });
            if (rRes.statusCode === 200 && rRes.json?.results?.length > 0) roleId = rRes.json.results[0].id;
          }
          if (!deviceTypeId) {
            const dtRes = await this.httpRequest(`${this.getApiBase()}/api/dcim/device-types/?limit=1`, { headers: this.getHeaders() });
            if (dtRes.statusCode === 200 && dtRes.json?.results?.length > 0) deviceTypeId = dtRes.json.results[0].id;
          }

          const createBody = {
            name,
            status: statusVal,
            ...(siteId ? { site: siteId } : {}),
            ...(roleId ? { role: roleId } : {}),
            ...(deviceTypeId ? { device_type: deviceTypeId } : {})
          };

          const createRes = await this.httpRequest(`${this.getApiBase()}/api/dcim/devices/`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(createBody)
          });

          if (createRes.statusCode >= 200 && createRes.statusCode < 300) {
            deviceResult = createRes.json;
          } else {
            throw new Error(`Failed to create NetBox device: HTTP ${createRes.statusCode}`);
          }
        }

        // Register IP in NetBox IPAM if provided
        let ipResult = null;
        if (virtualIp) {
          const cleanIp = virtualIp.includes('/') ? virtualIp : `${virtualIp}/24`;
          try {
            const ipCreateRes = await this.httpRequest(`${this.getApiBase()}/api/ipam/ip-addresses/`, {
              method: 'POST',
              headers: this.getHeaders(),
              body: JSON.stringify({
                address: cleanIp,
                status: 'active',
                description: `Synced from CyberVPS Agent: ${name}`
              })
            });
            if (ipCreateRes.statusCode >= 200 && ipCreateRes.statusCode < 300) {
              ipResult = ipCreateRes.json;
            }
          } catch (_) {}
        }

        return {
          success: true,
          action: existing ? 'updated' : 'created',
          device: deviceResult,
          ip: ipResult
        };
      }

      default:
        throw new Error(`Unsupported NetBox operation: ${operation}`);
    }
  }
}

module.exports = { NetBoxAdapter };
