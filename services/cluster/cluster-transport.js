/**
 * CYBERVPS END-CORE — Authenticated Cluster Transport & SSE Event Stream
 *
 * Provides:
 * - Real-time SSE streaming for End-Core Obsidian Pillars healing visualization
 * - Authenticated peer-to-peer cluster synchronization
 * - Cryptographic message signing & fencing verification
 */

const http = require('http');
const https = require('https');

class ClusterTransport {
  constructor(clusterState, recoveryCoordinator) {
    this.state = clusterState;
    this.coordinator = recoveryCoordinator;
    this.sseClients = new Set();

    // Attach to coordinator events and fan-out to SSE clients
    this.coordinator.subscribeEvents((event) => {
      this.broadcastSseEvent(event.type, event);
    });
  }

  // Handle SSE Client Connections (/api/v1/cluster/events)
  handleSseConnection(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write(`data: ${JSON.stringify({
      type: 'INITIAL_STATE',
      cluster_id: this.state.clusterId,
      epoch: this.state.epoch,
      leader_id: this.state.leaderId,
      quorum: this.state.getQuorumStatus(),
      nodes: Array.from(this.state.nodes.values()),
      tombstones: Array.from(this.state.tombstones.values()),
      timestamp: new Date().toISOString()
    })}\n\n`);

    this.sseClients.add(res);

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  broadcastSseEvent(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sseClients) {
      try { res.write(payload); } catch (_) {
        this.sseClients.delete(res);
      }
    }
  }

  // Broadcast state sync package to all reachable peers
  async broadcastStateToPeers() {
    const pkg = this.state.getClusterSyncPackage();
    const signature = this.state.signPayload(pkg);
    const results = [];

    for (const [backendId, node] of this.state.nodes.entries()) {
      if (backendId === this.state.selfNodeId) continue;
      if (this.state.tombstones.has(backendId)) continue;
      if (node.observed_state !== 'healthy') continue;

      try {
        const targetUrl = new URL(node.deployment_url.replace(/\/+$/, '') + '/api/v1/cluster/peer/sync');
        const isHttps = targetUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        const body = JSON.stringify(pkg);

        const req = client.request(targetUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cluster-ID': this.state.clusterId,
            'X-Node-ID': this.state.selfNodeId,
            'X-Cluster-Epoch': String(this.state.epoch),
            'X-Signature': signature,
            'Content-Length': Buffer.byteLength(body)
          },
          timeout: 3000
        }, (res) => {
          results.push({ backend_id: backendId, ok: res.statusCode === 200 });
        });

        req.on('error', () => {
          results.push({ backend_id: backendId, ok: false });
        });

        req.write(body);
        req.end();
      } catch (e) {
        results.push({ backend_id: backendId, ok: false, error: e.message });
      }
    }

    return results;
  }
}

module.exports = { ClusterTransport };
