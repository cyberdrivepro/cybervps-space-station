/**
 * FleetManager - Centralized Fleet Inventory, Hardware Profiling & Virtual IP Allocator
 * Manages cross-platform hosts (Windows, Linux, macOS, BSD, Embedded),
 * dynamic CIDR virtual IP allocation (10.77.0.0/24), liveness heartbeat tracking,
 * and authorized revocation/lifecycle controls.
 */

class FleetManager {
  constructor(storageAdapter, options = {}) {
    this.storage = storageAdapter;
    this.networkCidr = options.networkCidr || '10.77.0.0/24';
    this.baseVipOctet = options.baseVipOctet || 2;
    this.maxVipOctet = options.maxVipOctet || 254;
    this.offlineTimeoutMs = options.offlineTimeoutMs || 30000; // 30s offline threshold
    this.degradedTimeoutMs = options.degradedTimeoutMs || 10000; // 10s degraded threshold
    this.vipMap = new Map(); // ip -> machine_id
    this.revokedDevices = new Set();
  }

  async init() {
    // Populate VIP map from persisted machines
    const machines = await this.storage.list('machines');
    for (const m of machines) {
      if (m.virtual_ip) {
        this.vipMap.set(m.virtual_ip, m.id);
      }
      if (m.revoked) {
        this.revokedDevices.add(m.id);
      }
    }
    return machines.length;
  }

  /**
   * Enrolls or updates a host node in the fleet inventory.
   */
  async registerOrUpdate(payload) {
    if (!payload || !payload.machine_id) {
      throw new Error('machine_id is strictly required for fleet enrollment.');
    }

    const machineId = String(payload.machine_id).trim();
    if (this.revokedDevices.has(machineId)) {
      throw new Error(`Device [${machineId}] has been permanently revoked by administrator.`);
    }

    let existing = await this.storage.get('machines', machineId);
    let virtualIp = existing ? existing.virtual_ip : null;

    if (!virtualIp) {
      virtualIp = this._allocateVirtualIp(machineId);
    }

    const nowIso = new Date().toISOString();
    const normalizedOs = this._normalizeOs(payload.os, payload.platform);
    const normalizedArch = this._normalizeArch(payload.arch);

    const record = {
      id: machineId,
      hostname: payload.hostname || (existing ? existing.hostname : `node-${machineId.slice(0, 8)}`),
      username: payload.username || (existing ? existing.username : 'system'),
      os: normalizedOs,
      os_version: payload.os_version || payload.kernel || (existing ? existing.os_version : 'Unknown'),
      arch: normalizedArch,
      virtual_ip: virtualIp,
      agent_version: payload.agent_version || (existing ? existing.agent_version : '2.1.0'),
      status: 'online',
      last_seen: nowIso,
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : (existing ? existing.capabilities : ['terminal', 'files', 'bridge']),
      profile: {
        cpu_cores: payload.cpu_cores || (payload.profile && payload.profile.cpu_cores) || (existing && existing.profile ? existing.profile.cpu_cores : 1),
        ram_total_bytes: payload.ram_total || payload.memory_total_bytes || (existing && existing.profile ? existing.profile.ram_total_bytes : 0),
        disk_total_bytes: payload.disk_total || (existing && existing.profile ? existing.profile.disk_total_bytes : 0),
        uptime_seconds: payload.uptime_seconds || 0,
        ghost_mode: Boolean(payload.ghost_mode || (payload.profile && payload.profile.ghost_mode))
      },
      created_at: existing ? existing.created_at : nowIso,
      updated_at: nowIso,
      revoked: false
    };

    await this.storage.set('machines', machineId, record);
    this.vipMap.set(virtualIp, machineId);
    return record;
  }

  /**
   * Processes heartbeat and telemetry telemetry updates.
   */
  async processHeartbeat(machineId, telemetry = {}) {
    const existing = await this.storage.get('machines', machineId);
    if (!existing) {
      return { success: false, reason: 'machine_not_found' };
    }
    if (this.revokedDevices.has(machineId)) {
      return { success: false, reason: 'machine_revoked' };
    }

    const nowIso = new Date().toISOString();
    existing.last_seen = nowIso;
    existing.status = 'online';

    if (telemetry.uptime_seconds !== undefined) existing.profile.uptime_seconds = telemetry.uptime_seconds;
    if (telemetry.cpu_usage !== undefined) existing.profile.cpu_usage_pct = telemetry.cpu_usage;
    if (telemetry.memory_used_bytes !== undefined) existing.profile.ram_used_bytes = telemetry.memory_used_bytes;
    if (telemetry.agent_version) existing.agent_version = telemetry.agent_version;
    existing.updated_at = nowIso;

    await this.storage.set('machines', machineId, existing);
    return { success: true, virtual_ip: existing.virtual_ip, status: 'online' };
  }

  /**
   * Evaluates fleet liveness states (online -> degraded -> offline).
   */
  async evaluateLiveness() {
    const machines = await this.storage.list('machines');
    const now = Date.now();
    let updatedCount = 0;

    for (const m of machines) {
      if (m.revoked) continue;
      const lastSeenMs = new Date(m.last_seen || 0).getTime();
      const diff = now - lastSeenMs;

      let newStatus = 'online';
      if (diff > this.offlineTimeoutMs) {
        newStatus = 'offline';
      } else if (diff > this.degradedTimeoutMs) {
        newStatus = 'degraded';
      }

      if (m.status !== newStatus) {
        m.status = newStatus;
        m.updated_at = new Date().toISOString();
        await this.storage.set('machines', m.id, m);
        updatedCount++;
      }
    }
    return { evaluated: machines.length, updated: updatedCount };
  }

  /**
   * Permanently revokes a machine from the fleet.
   */
  async revokeDevice(machineId, reason = 'Administrator revocation') {
    this.revokedDevices.add(machineId);
    const existing = await this.storage.get('machines', machineId);
    if (existing) {
      existing.revoked = true;
      existing.status = 'revoked';
      existing.revocation_reason = reason;
      existing.updated_at = new Date().toISOString();
      await this.storage.set('machines', machineId, existing);
      if (existing.virtual_ip) {
        this.vipMap.delete(existing.virtual_ip);
      }
    }
    return { machine_id: machineId, revoked: true, reason };
  }

  async getMachine(machineId) {
    return this.storage.get('machines', machineId);
  }

  async listFleet(filter = {}) {
    return this.storage.list('machines', filter);
  }

  // Ergonomic aliases
  async registerMachine(payload) {
    return this.registerOrUpdate(payload);
  }

  async revokeMachine(machineId, reason) {
    return this.revokeDevice(machineId, reason);
  }

  async listMachines(filter = {}) {
    return this.listFleet(filter);
  }

  isRevoked(machineId) {
    return this.revokedDevices.has(machineId);
  }

  _allocateVirtualIp(machineId) {
    for (let octet = this.baseVipOctet; octet <= this.maxVipOctet; octet++) {
      const candidateIp = `10.77.0.${octet}`;
      if (!this.vipMap.has(candidateIp)) {
        return candidateIp;
      }
    }
    // Fallback if subnet is crowded
    return `10.77.1.${Math.floor(Math.random() * 200) + 10}`;
  }

  _normalizeOs(rawOs, platform) {
    const s = `${rawOs || ''} ${platform || ''}`.toLowerCase();
    if (s.includes('win') || s.includes('nt') || s.includes('powershell')) return 'Windows';
    if (s.includes('ubuntu')) return 'Ubuntu';
    if (s.includes('debian')) return 'Debian';
    if (s.includes('alpine')) return 'Alpine';
    if (s.includes('arch')) return 'Arch';
    if (s.includes('centos') || s.includes('rhel') || s.includes('fedora')) return 'RHEL/CentOS';
    if (s.includes('darwin') || s.includes('mac') || s.includes('osx')) return 'macOS';
    if (s.includes('linux')) return 'Linux';
    return 'Linux (Universal)';
  }

  _normalizeArch(rawArch) {
    const a = String(rawArch || '').toLowerCase();
    if (a.includes('64') || a.includes('amd64') || a.includes('x86_64')) return 'x86_64';
    if (a.includes('arm64') || a.includes('aarch64')) return 'ARM64';
    if (a.includes('arm')) return 'ARM';
    if (a.includes('386') || a.includes('x86')) return 'x86';
    return 'x86_64';
  }
}

module.exports = { FleetManager };
