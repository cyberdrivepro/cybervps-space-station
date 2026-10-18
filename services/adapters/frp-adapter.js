/**
 * CyberVPS Space Station - FRP (Fast Reverse Proxy) Adapter
 * Manages high-performance reverse TCP/UDP/HTTP tunnels through FRP servers.
 * Enforces destination safety (blocks metadata 169.254.169.254 & localhost admin services),
 * checks port conflicts, generates dynamic frpc.ini configurations, and audits tunnel lifecycles.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

// Dangerous destinations that must NEVER be exposed publicly
const BLOCKED_DESTINATIONS = [
  '169.254.169.254',       // AWS/Azure/GCP Cloud Metadata Service
  'metadata.google.internal',
  '127.0.0.1:8080',        // CyberVPS Control Plane internal API
  'localhost:8080',
  '127.0.0.1:3306',        // Raw local MySQL without auth
  '127.0.0.1:5432',        // Raw local Postgres
  '127.0.0.1:6379'         // Raw Redis
];

class FrpAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'frp',
      name: 'FRP (Fast Reverse Proxy)',
      category: 'tunnels',
      description: 'High-performance reverse proxy for exposing services behind NAT and firewalls via TCP, UDP, and HTTP.',
      version: '0.58.1',
      supportedOperations: ['test', 'list_tunnels', 'create_tunnel', 'delete_tunnel', 'generate_client_config', 'tunnel_health'],
      config: {
        server_addr: process.env.FRP_SERVER_ADDR || '',
        server_port: parseInt(process.env.FRP_SERVER_PORT || '7000', 10),
        dashboard_port: parseInt(process.env.FRP_DASHBOARD_PORT || '7500', 10),
        dashboard_user: process.env.FRP_DASHBOARD_USER || 'admin',
        dashboard_pwd: process.env.FRP_DASHBOARD_PWD || '',
        auth_token: process.env.FRP_AUTH_TOKEN || '',
        ...config
      }
    });

    this.activeTunnels = new Map();
  }

  isConfigured() {
    return Boolean(this.config.server_addr);
  }

  getDashboardBase() {
    const host = this.config.server_addr.trim().replace(/^https?:\/\//i, '').split(':')[0];
    const port = this.config.dashboard_port || 7500;
    return `http://${host}:${port}`;
  }

  getDashboardHeaders() {
    const creds = Buffer.from(`${this.config.dashboard_user || 'admin'}:${this.config.dashboard_pwd || ''}`).toString('base64');
    return {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CyberVPS-SpaceStation-FRP/1.0'
    };
  }

  /**
   * Validate destination to prevent SSRF and exposure of private metadata / admin interfaces
   */
  validateDestination(localIp, localPort) {
    const dest = `${localIp}:${localPort}`.toLowerCase();
    for (const b of BLOCKED_DESTINATIONS) {
      if (dest.includes(b.toLowerCase()) || localIp === b) {
        throw new Error(`Security Exception: Target destination '${dest}' is blocked. Public exposure of cloud metadata or privileged admin ports is strictly prohibited.`);
      }
    }
    // Block loopback ports < 1024 unless explicitly whitelisted (like port 80 or 443)
    if ((localIp === '127.0.0.1' || localIp === 'localhost') && localPort < 1024 && localPort !== 80 && localPort !== 443 && localPort !== 22) {
      throw new Error(`Security Exception: Privileged system port ${localPort} cannot be forwarded without explicit elevation.`);
    }
    return true;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'FRP server address not configured.' };
    }

    try {
      const res = await this.httpRequest(`${this.getDashboardBase()}/api/serverinfo`, {
        method: 'GET',
        headers: this.getDashboardHeaders(),
        timeout: 4000
      });

      this.lastLatencyMs = res.latencyMs;
      if (res.statusCode === 200) {
        this.status = ADAPTER_STATUS.CONNECTED;
        this.lastSync = new Date().toISOString();
        this.lastError = null;
        const info = res.json || {};
        return {
          success: true,
          status: this.status,
          latency_ms: res.latencyMs,
          details: {
            server_addr: this.config.server_addr,
            server_port: this.config.server_port,
            version: info.version || '0.58+',
            total_traffic_in: info.total_traffic_in || 0,
            total_traffic_out: info.total_traffic_out || 0,
            cur_conns: info.cur_conns || 0
          }
        };
      } else if (res.statusCode === 401) {
        this.status = ADAPTER_STATUS.UNAUTHORIZED;
        this.lastError = 'Unauthorized: FRP Dashboard basic authentication failed.';
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      } else {
        this.status = ADAPTER_STATUS.DEGRADED;
        this.lastError = `FRP server returned HTTP ${res.statusCode}`;
        return { success: false, status: this.status, latency_ms: res.latencyMs, error: this.lastError };
      }
    } catch (err) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = err.message;
      return { success: false, status: this.status, error: `Could not reach FRP server: ${err.message}` };
    }
  }

  /**
   * Generate an frpc.ini configuration file content for an enrolled node
   */
  generateClientConfig(tunnel) {
    return `[common]
server_addr = ${this.config.server_addr}
server_port = ${this.config.server_port}
token = ${this.config.auth_token || ''}
tcp_mux = true

[${tunnel.name}]
type = ${tunnel.type || 'tcp'}
local_ip = ${tunnel.local_ip || '127.0.0.1'}
local_port = ${tunnel.local_port}
remote_port = ${tunnel.remote_port}
use_encryption = true
use_compression = true
`;
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_tunnels': {
        const tunnels = Array.from(this.activeTunnels.values());
        try {
          const res = await this.httpRequest(`${this.getDashboardBase()}/api/proxy/tcp`, {
            method: 'GET',
            headers: this.getDashboardHeaders()
          });
          if (res.statusCode === 200 && res.json && Array.isArray(res.json.proxies)) {
            const liveMap = new Map(res.json.proxies.map(p => [p.name, p]));
            for (const t of tunnels) {
              const live = liveMap.get(t.name);
              t.online = live ? (live.status === 'online') : false;
              if (live) {
                t.cur_conns = live.cur_conns;
                t.today_traffic_in = live.today_traffic_in;
                t.today_traffic_out = live.today_traffic_out;
              }
            }
          }
        } catch (_) {}
        return tunnels;
      }

      case 'create_tunnel': {
        const { name, machine_id, type = 'tcp', local_ip = '127.0.0.1', local_port, remote_port } = params;
        if (!name) throw new Error('Tunnel name is required');
        if (!local_port) throw new Error('local_port is required');
        if (!remote_port) throw new Error('remote_port is required');

        this.validateDestination(local_ip, parseInt(local_port, 10));

        // Check port conflicts against existing registered tunnels
        for (const [id, t] of this.activeTunnels) {
          if (t.remote_port === parseInt(remote_port, 10) && t.name !== name) {
            throw new Error(`Port Conflict: Remote port ${remote_port} is already assigned to tunnel '${t.name}' (Machine: ${t.machine_id}).`);
          }
        }

        const tunnelObj = {
          id: `frp_${name}_${Date.now()}`,
          name,
          machine_id: machine_id || 'unassigned',
          type,
          local_ip,
          local_port: parseInt(local_port, 10),
          remote_port: parseInt(remote_port, 10),
          server_addr: this.config.server_addr,
          status: 'configured',
          online: false,
          created_at: new Date().toISOString()
        };

        this.activeTunnels.set(tunnelObj.name, tunnelObj);
        tunnelObj.client_config = this.generateClientConfig(tunnelObj);
        return tunnelObj;
      }

      case 'remove_tunnel':
      case 'delete_tunnel': {
        const { name } = params;
        if (!name) throw new Error('Tunnel name is required');
        const deleted = this.activeTunnels.delete(name);
        return { success: deleted, name };
      }

      case 'generate_client_config': {
        const { name } = params;
        const tunnel = this.activeTunnels.get(name) || params;
        if (!tunnel || !tunnel.remote_port) throw new Error('Tunnel configuration not found');
        return {
          format: 'ini',
          filename: `frpc_${tunnel.name || 'tunnel'}.ini`,
          content: this.generateClientConfig(tunnel)
        };
      }

      case 'tunnel_health': {
        const { remote_port } = params;
        if (!remote_port) throw new Error('remote_port is required');
        const host = this.config.server_addr.trim().replace(/^https?:\/\//i, '').split(':')[0];
        const net = require('net');
        return new Promise((resolve) => {
          const t0 = Date.now();
          const socket = new net.Socket();
          socket.setTimeout(3000);
          socket.connect(parseInt(remote_port, 10), host, () => {
            const ms = Date.now() - t0;
            socket.destroy();
            resolve({ healthy: true, latency_ms: ms, endpoint: `${host}:${remote_port}` });
          });
          socket.on('error', (e) => {
            socket.destroy();
            resolve({ healthy: false, error: e.message, endpoint: `${host}:${remote_port}` });
          });
          socket.on('timeout', () => {
            socket.destroy();
            resolve({ healthy: false, error: 'Connection timed out', endpoint: `${host}:${remote_port}` });
          });
        });
      }

      default:
        throw new Error(`Unsupported FRP operation: ${operation}`);
    }
  }
}

module.exports = { FrpAdapter };
