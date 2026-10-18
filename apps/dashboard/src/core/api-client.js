/**
 * CYBERVPS SPACE STATION - ROBUST FRONTEND API CLIENT
 * Multi-Backend Failover, Auto-Header Injection & Exponential Backoff
 */

class StationApiClient {
  constructor(stateStore) {
    this.store = stateStore;
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    this.candidateBackends = [
      'https://cybervps-space-station.up.railway.app',
      'https://cybervpsbackend4.getvoroa.com',
      'https://cybervps-render-control.onrender.com'
    ];
    if (!isHttps) {
      this.candidateBackends.push('http://localhost:8080');
    }
  }

  getBaseUrl() {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const fallbackDefault = isHttps ? 'https://cybervps-space-station.up.railway.app' : 'http://localhost:8080';
    return this.store.get('backendUrl') || fallbackDefault;
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const pairingKey = this.store.get('pairingKey');
    if (pairingKey) {
      headers['X-CVPS-Pairing-Key'] = pairingKey;
    }

    const sessionToken = this.store.get('sessionToken');
    if (sessionToken) {
      headers['X-CVPS-Session-Token'] = sessionToken;
      headers['Authorization'] = `Bearer ${sessionToken}`;
    }

    return headers;
  }

  async request(endpoint, options = {}, retries = 2) {
    let baseUrl = this.getBaseUrl();
    let url = `${baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...(options.headers || {})
        }
      });

      if (!response.ok) {
        let errData;
        try {
          errData = await response.json();
        } catch (_) {
          errData = { error: `HTTP ${response.status}: ${response.statusText}` };
        }
        throw new Error(errData.detail || errData.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      if (retries > 0) {
        // Try fallback backend if primary fails
        for (const fallback of this.candidateBackends) {
          if (fallback !== baseUrl) {
            try {
              const fallbackUrl = `${fallback}${endpoint}`;
              const fbRes = await fetch(fallbackUrl, {
                ...options,
                headers: { ...this.getHeaders(), ...(options.headers || {}) }
              });
              if (fbRes.ok) {
                this.store.set('backendUrl', fallback);
                this.store.addNotification('info', `Switched active backend to fallback: ${fallback}`);
                return await fbRes.json();
              }
            } catch (_) {}
          }
        }
      }
      throw err;
    }
  }

  // 19 Module API Methods
  async getOverview() { return this.request('/api/v1/overview'); }
  async getMachines() { return this.request('/api/v1/machines'); }
  async getRecoveryProfile(uuid) { return this.request(`/api/v1/disaster-recovery/profile?hardware_uuid=${encodeURIComponent(uuid)}`); }
  async saveRecoveryProfile(data) {
    return this.request('/api/v1/disaster-recovery/profile', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
  async getApps(machineId) { return this.request(`/api/v1/apps/list?machine_id=${encodeURIComponent(machineId)}`); }
  async launchApp(machineId, executable, args = []) {
    return this.request('/api/v1/apps/launch', {
      method: 'POST',
      body: JSON.stringify({ machine_id: machineId, executable, args })
    });
  }
  async getProcesses(machineId) { return this.request(`/api/v1/processes/list?machine_id=${encodeURIComponent(machineId)}`); }
  async killProcess(machineId, pid) {
    return this.request('/api/v1/processes/kill', {
      method: 'POST',
      body: JSON.stringify({ machine_id: machineId, pid: Number(pid) })
    });
  }
  async createTerminalSession(machineId, shell = 'auto') {
    return this.request('/api/v1/terminal/session', {
      method: 'POST',
      body: JSON.stringify({ machine_id: machineId, shell })
    });
  }
  async listFiles(machineId, dirPath = '/') {
    return this.request(`/api/v1/files/list?machine_id=${encodeURIComponent(machineId)}&path=${encodeURIComponent(dirPath)}`);
  }
  async getBridgeMappings() { return this.request('/api/v1/bridge/mappings'); }
  async createBridgeMapping(machineId, targetPort, alias = '') {
    return this.request('/api/v1/bridge/mappings', {
      method: 'POST',
      body: JSON.stringify({ machine_id: machineId, target_port: Number(targetPort), alias })
    });
  }
  async getClusterTopology() { return this.request('/api/v1/cluster/topology'); }
  async getMeshRoutes() { return this.request('/api/v1/mesh/routes'); }
  async runDoctorDiagnostics() { return this.request('/api/v1/doctor/run'); }
  async runDoctorRemediation(action) {
    return this.request('/api/v1/doctor/run', {
      method: 'POST',
      body: JSON.stringify({ action })
    });
  }
  async getAuditLogs(filters = {}) {
    const params = new URLSearchParams(filters);
    return this.request(`/api/v1/audit/logs?${params.toString()}`);
  }
  async triggerMachineAction(machineId, action, params = {}) {
    return this.request(`/api/v1/machines/${encodeURIComponent(machineId)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, params })
    });
  }
  async getSettings() { return this.request('/api/v1/settings'); }
  async saveSettings(settings) {
    return this.request('/api/v1/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  }
}

if (typeof window !== 'undefined') {
  window.StationApiClient = StationApiClient;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StationApiClient;
}
