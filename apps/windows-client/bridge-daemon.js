/**
 * CyberVPS SPACE STATION - Native Windows Client & Local Port Bridge Daemon
 * Accepts connections on local Windows ports (127.0.0.1:<local_port>)
 * and tunnels raw TCP/HTTP streams to remote machines across the Space Station Relay.
 */

const net = require('net');
const http = require('http');
const { WebSocket } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

if (process.env.CYBERVPS_LOG_FILE) {
  try {
    const logDir = path.dirname(process.env.CYBERVPS_LOG_FILE);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logStream = fs.createWriteStream(process.env.CYBERVPS_LOG_FILE, { flags: 'a' });
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a) => {
      origLog(...a);
      logStream.write(a.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(' ') + '\n');
    };
    console.error = (...a) => {
      origErr(...a);
      logStream.write('[ERR] ' + a.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(' ') + '\n');
    };
  } catch (_) {}
}

class WindowsPortBridgeClient {

  constructor(options = {}) {
    this.serverUrl = options.serverUrl || 'http://localhost:8080';
    this.wsUrl = this.serverUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    this.machineId = options.machineId || ('win_bridge_' + crypto.randomBytes(4).toString('hex'));
    this.token = options.token || process.env.CYBERVPS_AGENT_TOKEN || process.env.ENROLLMENT_TOKEN || '';
    this.activeMappings = new Map(); // id -> { machineId, remotePort, localPort, server, activeSockets }
    this.relayWs = null;
    this.activeStreams = new Map(); // streamId -> net.Socket
    this.outboxQueue = [];
    this.running = true;
  }

  async start(autoSync = true) {
    console.log('================================================================');
    console.log('🪟 CYBERVPS SPACE STATION - NATIVE WINDOWS PORT BRIDGE ACTIVE');
    console.log(`Relay Target: ${this.serverUrl}`);
    console.log('================================================================\n');

    await this.connectRelay();
    if (autoSync) {
      this.syncMappingsLoop();
    }
  }

  connectRelay() {
    return new Promise((resolve) => {
      const wsEndpoint = `${this.wsUrl}/api/v1/relay/connect`;
      console.log(`[*] Connecting to Space Station Relay at ${wsEndpoint}...`);

      this.relayWs = new WebSocket(wsEndpoint);

      this.relayWs.on('open', () => {
        console.log('✅ Connected to Space Station Relay.');
        this.relayWs.send(JSON.stringify({
          type: 'Auth',
          payload: {
            machine_id: this.machineId,
            token: this.token,
            agent_version: '1.0.0',
            hostname: require('os').hostname(),
            os: 'Windows',
            os_version: '11/Server',
            arch: process.arch,
            capabilities: { is_root: false, pty_supported: true }
          }
        }));

        while (this.outboxQueue.length > 0) {
          const item = this.outboxQueue.shift();
          this.relayWs.send(JSON.stringify(item));
        }

        resolve();
      });

      this.relayWs.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleRelayMessage(msg);
        } catch (e) {
          console.error('Error parsing relay message:', e);
        }
      });

      this.relayWs.on('close', () => {
        if (this.running) {
          console.log('⚠️ Relay connection closed. Reconnecting in 3s...');
          setTimeout(() => this.connectRelay(), 3000);
        }
      });

      this.relayWs.on('error', () => {});
    });
  }

  handleRelayMessage(msg) {
    const { type, payload } = msg;

    if (type === 'TunnelData') {
      const { stream_id, data_base64 } = payload;
      const sock = this.activeStreams.get(stream_id);
      if (sock && !sock.destroyed) {
        sock.write(Buffer.from(data_base64, 'base64'));
      }
    } else if (type === 'TunnelStreamClosed') {
      const { stream_id } = payload;
      const sock = this.activeStreams.get(stream_id);
      if (sock) {
        sock.end();
        this.activeStreams.delete(stream_id);
      }
    }
  }

  /**
   * Adds or activates a local port mapping on the Windows PC
   * Maps 127.0.0.1:<localPort> -> <machineId>:<remotePort>
   */
  async addMapping(mappingId, machineId, remotePort, preferredLocalPort = null) {
    for (const [id, m] of this.activeMappings) {
      if (m.machineId === machineId && m.remotePort === remotePort) {
        return m;
      }
    }

    if (this.activeMappings.has(mappingId)) {
      return this.activeMappings.get(mappingId);
    }

    let localPort = preferredLocalPort || remotePort;

    // Create local TCP server on Windows
    const server = net.createServer((clientSocket) => {
      const streamId = 'bridge_stream_' + crypto.randomUUID().slice(0, 8);
      this.activeStreams.set(streamId, clientSocket);

      // Instruct relay to route stream to remote machine & port
      this.sendRelayMessage({
        type: 'TunnelOpenStream',
        payload: {
          tunnel_id: mappingId,
          stream_id: streamId,
          target_port: remotePort,
          destination_machine: machineId
        }
      });

      clientSocket.on('data', (chunk) => {
        this.sendRelayMessage({
          type: 'TunnelData',
          payload: {
            tunnel_id: mappingId,
            stream_id: streamId,
            data_base64: chunk.toString('base64')
          }
        });
      });

      clientSocket.on('end', () => {
        this.sendRelayMessage({
          type: 'TunnelCloseStream',
          payload: { tunnel_id: mappingId, stream_id: streamId }
        });
        this.activeStreams.delete(streamId);
      });

      clientSocket.on('error', (err) => {
        this.activeStreams.delete(streamId);
      });
    });

    // Conflict-safe bind attempt
    let boundPort = await this.bindServerConflictSafe(server, localPort);

    const mapping = {
      id: mappingId,
      machineId,
      remotePort,
      localPort: boundPort,
      server,
      hasConflict: boundPort !== localPort
    };

    this.activeMappings.set(mappingId, mapping);
    console.log(`⚡ [BRIDGE ACTIVE] Local 127.0.0.1:${boundPort} <---> Remote [${machineId}]:${remotePort}`);
    if (mapping.hasConflict) {
      console.log(`   (Note: Preferred port ${localPort} was occupied. Automatically resolved to ${boundPort})`);
    }

    return mapping;
  }

  bindServerConflictSafe(server, preferredPort) {
    return new Promise((resolve) => {
      server.listen(preferredPort, '127.0.0.1', () => {
        resolve(preferredPort);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          // Port occupied! Fall back to port 0 (OS will assign an available port)
          console.log(`⚠️ Port ${preferredPort} is in use on this PC. Finding next available port...`);
          const fallbackServer = net.createServer(server._events.connection);
          fallbackServer.listen(0, '127.0.0.1', () => {
            const actualPort = fallbackServer.address().port;
            resolve(actualPort);
          });
        } else {
          resolve(preferredPort);
        }
      });
    });
  }

  sendRelayMessage(msg) {
    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      this.relayWs.send(JSON.stringify(msg));
    } else {
      this.outboxQueue.push(msg);
    }
  }

  async syncMappingsLoop() {
    while (this.running) {
      try {
        // Query Control Plane for configured bridge mappings
        const res = await fetch(`${this.serverUrl}/api/v1/bridge/mappings`).catch(() => null);
        if (res && res.ok) {
          const mappings = await res.json();
          for (const m of mappings) {
            if (m.status === 'active' && !this.activeMappings.has(m.id)) {
              await this.addMapping(m.id, m.machine_id, m.remote_port, m.local_port);
            }
          }
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 4000));
    }
  }

  stop() {
    this.running = false;
    for (const [id, m] of this.activeMappings) {
      m.server.close();
    }
    if (this.relayWs) this.relayWs.close();
  }
}

if (require.main === module) {
  const targetServer = process.argv[2] || 'http://localhost:8080';
  const bridge = new WindowsPortBridgeClient({ serverUrl: targetServer });
  bridge.start();
}

module.exports = { WindowsPortBridgeClient };
