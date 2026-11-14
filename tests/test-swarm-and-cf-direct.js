/**
 * Test: 20-Agent Swarm Mesh, Sibling Failover, and Cloudflare Direct-Connect Endpoints
 */
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = 8089;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/api/v1/relay/connect`;

process.env.PORT = PORT;
process.env.NODE_ENV = 'test';
process.env.ENABLE_TUNNEL = 'false';
process.env.ENROLLMENT_TOKEN = 'test_enroll_token_999';

// Helper for HTTP requests
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(parsed, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runSwarmTests() {
  console.log('--- STARTING 20-AGENT SWARM & CLOUDFLARE DIRECT LINK TESTS ---');

  // Start Space Station Server
  const serverPath = path.join(__dirname, '../services/server.js');
  const serverModule = require(serverPath);
  await new Promise(r => setTimeout(r, 1500));

  console.log('[1] Testing /api/v1/tunnel/public-url and /api/v1/cluster/public-links...');
  const pubUrlRes = await httpRequest(`${SERVER_URL}/api/v1/tunnel/public-url`);
  assert.strictEqual(pubUrlRes.statusCode, 200, 'Public tunnel URL endpoint should return 200');
  const pubUrlData = JSON.parse(pubUrlRes.body);
  assert(pubUrlData.ok === true || pubUrlData.success === true, 'Public tunnel URL response ok should be true');
  console.log('  ✅ /api/v1/tunnel/public-url is operational:', pubUrlData.public_url || 'local');

  const clusterRes = await httpRequest(`${SERVER_URL}/api/v1/cluster/public-links`);
  assert.strictEqual(clusterRes.statusCode, 200, 'Cluster public links should return 200');
  const clusterData = JSON.parse(clusterRes.body);
  assert(Array.isArray(clusterData.links), 'Cluster links should be an array');
  console.log(`  ✅ /api/v1/cluster/public-links returned ${clusterData.links.length} links`);

  console.log('[2] Enrolling a 20-Agent Swarm on a single host machine...');
  const baseMid = 'swarm-host-pc-01';
  const cfTestLink = 'https://swarm-mesh-direct-connect.trycloudflare.com';
  const wsWorkers = [];

  for (let i = 1; i <= 20; i++) {
    const workerIndex = i;
    const workerMid = `${baseMid}-w${String(workerIndex).padStart(2, '0')}`;
    const ws = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout connecting worker ${i}`)), 5000);
      ws.on('open', () => {
        // Send Auth with swarm metadata in payload
        ws.send(JSON.stringify({
          type: 'Auth',
          payload: {
            machine_id: workerMid,
            token: 'test_enroll_token_999',
            hostname: 'DESKTOP-SWARM-HOST',
            os: 'Windows 11 Pro',
            arch: 'x86_64',
            agent_version: '3.1.0-swarm20',
            swarm_role: 'worker',
            swarm_index: workerIndex,
            swarm_total: 20,
            swarm_cluster: baseMid,
            cloudflare_tunnel_url: cfTestLink
          }
        }));
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'AuthAck' && msg.payload && msg.payload.success) {
            clearTimeout(timeout);
            resolve();
          }
        } catch (_) {}
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    wsWorkers.push(ws);
  }

  console.log('  ✅ All 20 worker agents connected and authenticated simultaneously!');

  console.log('[3] Testing /api/v1/swarm/nodes endpoint...');
  const nodesRes = await httpRequest(`${SERVER_URL}/api/v1/swarm/nodes`);
  assert.strictEqual(nodesRes.statusCode, 200);
  const nodesData = JSON.parse(nodesRes.body);
  assert(nodesData.success === true);
  assert(nodesData.nodes && nodesData.nodes.length >= 20, 'Should have at least 20 nodes in swarm');
  const swarmWorkers = nodesData.nodes.filter(n => n.id.startsWith(baseMid));
  assert.strictEqual(swarmWorkers.length, 20, 'Should register 20 workers for the cluster');
  assert(swarmWorkers.every(w => w.status === 'online'), 'All 20 workers must be online');
  assert(swarmWorkers.every(w => w.public_url === cfTestLink), 'All 20 workers must expose Cloudflare tunnel');
  console.log('  ✅ /api/v1/swarm/nodes verified: 20/20 active workers, CF link:', cfTestLink);

  console.log('[4] Testing /api/v1/swarm/summary endpoint...');
  const sumRes = await httpRequest(`${SERVER_URL}/api/v1/swarm/summary`);
  assert.strictEqual(sumRes.statusCode, 200);
  const sumData = JSON.parse(sumRes.body);
  assert(sumData.success === true);
  assert(sumData.online_workers >= 20, 'Online workers should be at least 20');
  console.log('  ✅ /api/v1/swarm/summary verified: total online workers:', sumData.online_workers);

  console.log('[5] Testing Swarm Sibling Failover in server.js...');
  // The baseMid is not connected directly; only baseMid-w01 .. baseMid-w20 are connected.
  // getAgentSocket(baseMid) should automatically resolve to an available sibling worker!
  const resolvedWs = serverModule.getAgentSocket(baseMid);
  assert(resolvedWs, 'Sibling failover should resolve an active worker socket for the cluster');
  assert.strictEqual(resolvedWs.readyState, WebSocket.OPEN, 'Resolved sibling worker socket must be open');
  console.log('  ✅ Swarm Sibling Failover verified: base machine routing resolved to live worker socket');

  console.log('[6] Clean up ws workers...');
  for (const ws of wsWorkers) {
    try { ws.close(); } catch (_) {}
  }

  console.log('================================================================');
  console.log('🎉 ALL 20-AGENT SWARM & CLOUDFLARE DIRECT LINK TESTS PASSED!');
  console.log('================================================================');
  process.exit(0);
}

runSwarmTests().catch(err => {
  console.error('❌ Swarm test failed:', err);
  process.exit(1);
});
