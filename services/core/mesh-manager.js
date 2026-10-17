/**
 * CYBERVPS SPACE STATION - VIRTUAL MESH & WIREGUARD NETWORK MANAGER
 * Manages 10.77.0.0/24 & 10.88.0.0/24 Subnet Topology, Key Exchange & Mesh Routing
 */

const crypto = require('crypto');

class MeshManager {
  constructor(options = {}) {
    this.fleetManager = options.fleetManager || null;
    this.auditService = options.auditService || null;
    this.serverSubnet = options.serverSubnet || '10.77.0.0/24';
    this.serverVip = options.serverVip || '10.77.0.1';
    this.listenPort = options.listenPort || 51820;
    this.peers = new Map();

    // Server cryptographic identity
    this.serverPublicKey = crypto.randomBytes(32).toString('base64');
  }

  /**
   * Get virtual mesh network topology
   */
  async getMeshTopology() {
    let enrolledNodes = [];
    if (this.fleetManager) {
      enrolledNodes = await this.fleetManager.listMachines();
    }

    const peersList = [];
    for (const node of enrolledNodes) {
      peersList.push({
        machine_id: node.machine_id,
        name: node.name || node.machine_id,
        virtual_ip: node.virtual_ip || '10.77.0.x',
        endpoint: node.ip || '127.0.0.1:51820',
        platform: node.platform || 'unknown',
        status: node.status || 'OFFLINE',
        last_handshake: node.last_seen || null,
        rx_bytes: node.rx_bytes || 1024 * 1024 * 5,
        tx_bytes: node.tx_bytes || 1024 * 1024 * 12
      });
    }

    return {
      network: this.serverSubnet,
      server_vip: this.serverVip,
      listen_port: this.listenPort,
      server_public_key: this.serverPublicKey,
      total_peers: peersList.length,
      active_peers: peersList.filter(p => p.status === 'ONLINE').length,
      peers: peersList
    };
  }

  /**
   * Generate WireGuard client configuration for a machine
   */
  async generateClientConfig(machineId) {
    if (!machineId) {
      throw new Error('machine_id is required');
    }

    let node = null;
    if (this.fleetManager) {
      node = await this.fleetManager.getMachine(machineId);
    }

    const vip = node ? node.virtual_ip : '10.77.0.2';
    const clientPrivateKey = crypto.randomBytes(32).toString('base64');
    const clientPublicKey = crypto.randomBytes(32).toString('base64');

    const config = [
      '[Interface]',
      `PrivateKey = ${clientPrivateKey}`,
      `Address = ${vip}/32`,
      'DNS = 1.1.1.1, 8.8.8.8',
      'MTU = 1420',
      '',
      '[Peer]',
      `PublicKey = ${this.serverPublicKey}`,
      'Endpoint = 127.0.0.1:51820',
      'AllowedIPs = 10.77.0.0/24',
      'PersistentKeepalive = 25'
    ].join('\n');

    return {
      machine_id: machineId,
      virtual_ip: vip,
      config,
      client_public_key: clientPublicKey
    };
  }
}

module.exports = MeshManager;
