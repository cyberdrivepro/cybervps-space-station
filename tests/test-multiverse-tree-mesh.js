/**
 * Test: Multiverse Tree Mesh Architecture
 * Verifies N Systems × 20 Leaves formula (1 sys = 20 links, 2 sys = 40 links, 4 sys = 80 links),
 * Inter-system cross-connection, gossip, and direct leaf routing.
 */
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PORT = 8092;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/api/v1/relay/connect`;

process.env.PORT = PORT;
process.env.NODE_ENV = 'test';
process.env.ENABLE_TUNNEL = 'false';
process.env.ENROLLMENT_TOKEN = 'test_enroll_token_999';

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

async function runMultiverseTreeTests() {
  console.log('--- STARTING MULTIVERSE TREE MESH VERIFICATION ---');

  // Start Server
  const serverPath = path.join(__dirname, '../services/server.js');
  const serverModule = require(serverPath);
  await new Promise(r => setTimeout(r, 1200));

  const allSockets = [];

  // Helper to enroll a system with 20 workers
  async function enrollSystemWith20Leaves(systemId, hostname, cfTunnelUrl) {
    for (let w = 1; w <= 20; w++) {
      const wId = w === 1 ? systemId : `${systemId}-w${String(w).padStart(2, '0')}`;
      const ws = new WebSocket(WS_URL);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout enrolling ${wId}`)), 5000);
        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'Auth',
            payload: {
              machine_id: wId,
              token: 'test_enroll_token_999',
              hostname: hostname,
              os: 'Windows 11 Pro',
              arch: 'x86_64',
              agent_version: '3.2.0-multiverse-tree',
              swarm_role: w === 1 ? 'coordinator' : 'worker',
              swarm_index: w,
              swarm_total: 20,
              swarm_cluster: systemId,
              tree_role: 'leaf',
              tree_branch: systemId,
              tree_leaf_id: wId,
              tree_leaf_index: w,
              tree_leaf_total: 20,
              cloudflare_tunnel_url: cfTunnelUrl
            }
          }));
        });
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'AuthAck' && msg.payload && msg.payload.success) {
              clearTimeout(timer);
              resolve();
            }
          } catch (_) {}
        });
        ws.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      allSockets.push(ws);
    }
  }

  // TEST 1: Register System 1 -> Must generate exactly 20 leaf links
  console.log('[TEST 1] Registering System 1 (DESKTOP-SYSTEM-01) with 20 workers...');
  await enrollSystemWith20Leaves('DESKTOP-SYSTEM-01', 'DESKTOP-SYSTEM-01', 'https://sys1-mesh.trycloudflare.com');

  let topoRes = await httpRequest(`${SERVER_URL}/api/v1/tree/multiverse`);
  assert.strictEqual(topoRes.statusCode, 200);
  let topo = JSON.parse(topoRes.body);
  assert(topo.success === true, 'Multiverse tree query must succeed');
  
  // Filter for our test systems
  const sys1Branch = topo.branches.find(b => b.branch_id === 'DESKTOP-SYSTEM-01');
  assert(sys1Branch, 'System 1 branch must be present in tree');
  assert.strictEqual(sys1Branch.leaves.length, 20, 'System 1 must have exactly 20 leaves');
  assert.strictEqual(sys1Branch.leaves_count, 20);
  console.log(`  ✅ 1 System registered -> Verified 20 leaf links generated (Branch: ${sys1Branch.branch_id})`);

  // TEST 2: Register System 2 -> Must generate 40 total leaf links (2 * 20)
  console.log('\n[TEST 2] Registering System 2 (UBUNTU-SERVER-02) -> Verifying 40 Leaf Links...');
  await enrollSystemWith20Leaves('UBUNTU-SERVER-02', 'UBUNTU-SERVER-02', 'https://sys2-mesh.trycloudflare.com');

  topoRes = await httpRequest(`${SERVER_URL}/api/v1/tree/multiverse`);
  topo = JSON.parse(topoRes.body);
  const sys1 = topo.branches.find(b => b.branch_id === 'DESKTOP-SYSTEM-01');
  const sys2 = topo.branches.find(b => b.branch_id === 'UBUNTU-SERVER-02');
  assert(sys1 && sys2, 'Both System 1 and System 2 must be present in tree');
  assert.strictEqual(sys1.leaves.length, 20);
  assert.strictEqual(sys2.leaves.length, 20);

  const sysLeaves2 = topo.all_leaf_links.filter(l => l.branch_id === 'DESKTOP-SYSTEM-01' || l.branch_id === 'UBUNTU-SERVER-02');
  assert.strictEqual(sysLeaves2.length, 40, '2 Systems must produce exactly 40 leaf links');
  console.log(`  ✅ 2 Systems registered -> Verified 40 leaf links generated (20 + 20)`);

  // TEST 3: Register System 3 and System 4 -> Must scale to 80 leaf links (4 * 20)
  console.log('\n[TEST 3] Registering Systems 3 & 4 (DEBIAN-NODE-03 & WIN-HOST-04) -> Verifying 80 Leaf Links...');
  await enrollSystemWith20Leaves('DEBIAN-NODE-03', 'DEBIAN-NODE-03', 'https://sys3-mesh.trycloudflare.com');
  await enrollSystemWith20Leaves('WIN-HOST-04', 'WIN-HOST-04', 'https://sys4-mesh.trycloudflare.com');

  topoRes = await httpRequest(`${SERVER_URL}/api/v1/tree/multiverse`);
  topo = JSON.parse(topoRes.body);
  const targetBranches = ['DESKTOP-SYSTEM-01', 'UBUNTU-SERVER-02', 'DEBIAN-NODE-03', 'WIN-HOST-04'];
  for (const bId of targetBranches) {
    const b = topo.branches.find(br => br.branch_id === bId);
    assert(b, `Branch ${bId} must exist in tree`);
    assert.strictEqual(b.leaves.length, 20, `${bId} must have 20 leaves`);
  }
  const sysLeaves4 = topo.all_leaf_links.filter(l => targetBranches.includes(l.branch_id));
  assert.strictEqual(sysLeaves4.length, 80, '4 Systems must produce exactly 80 leaf links');
  console.log(`  ✅ 4 Systems registered -> Verified 80 leaf links generated (4 × 20 = 80)`);

  // TEST 4: Verifying Inter-System Cross Peering
  console.log('\n[TEST 4] Verifying Inter-System Cross Peering Matrix...');
  for (const bId of targetBranches) {
    const b = topo.branches.find(br => br.branch_id === bId);
    // Each branch must be interconnected to all other 3 target branches
    const peeredTargets = b.interconnected_peers.map(p => p.peer_system_id);
    for (const otherId of targetBranches) {
      if (otherId !== bId) {
        assert(peeredTargets.includes(otherId), `Branch ${bId} must be interconnected to ${otherId}`);
      }
    }
  }
  console.log('  ✅ Fully connected mesh verified: All systems are interconnected in tree graph');

  // TEST 5: Flat list endpoint /api/v1/tree/leaves
  console.log('\n[TEST 5] Verifying /api/v1/tree/leaves flat links endpoint...');
  const leavesRes = await httpRequest(`${SERVER_URL}/api/v1/tree/leaves`);
  assert.strictEqual(leavesRes.statusCode, 200);
  const leavesData = JSON.parse(leavesRes.body);
  assert(leavesData.success === true);
  assert(Array.isArray(leavesData.leaf_links));
  const test4Leaves = leavesData.leaf_links.filter(l => targetBranches.includes(l.branch_id));
  assert.strictEqual(test4Leaves.length, 80);
  console.log(`  ✅ /api/v1/tree/leaves verified: Flat list correctly returns ${test4Leaves.length} leaf links for the 4 systems`);

  // TEST 6: Testing Inter-System Cross-Route Command Delivery
  console.log('\n[TEST 6] Testing Inter-System Cross-Route Command (System 1 Leaf -> System 2)...');
  const xRouteRes = await httpRequest(`${SERVER_URL}/api/v1/tree/cross-route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_leaf: 'DESKTOP-SYSTEM-01-leaf05',
      target_system: 'UBUNTU-SERVER-02',
      action: 'ping',
      payload: { hello: 'from_sys1' }
    })
  });
  assert.strictEqual(xRouteRes.statusCode, 200);
  const xRouteData = JSON.parse(xRouteRes.body);
  assert(xRouteData.success === true, 'Cross route execution must succeed');
  assert.strictEqual(xRouteData.target_system, 'UBUNTU-SERVER-02');
  assert(xRouteData.mesh_route.includes('Multiverse Core'));
  console.log(`  ✅ Inter-System Cross Route successful: ${xRouteData.mesh_route} (Hop: ${xRouteData.hop_count})`);

  // TEST 7: Testing Tree Gossip Announcement
  console.log('\n[TEST 7] Testing Inter-System Tree Gossip (/api/v1/tree/gossip)...');
  const gossipRes = await httpRequest(`${SERVER_URL}/api/v1/tree/gossip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_id: 'UBUNTU-SERVER-02',
      cloudflare_tunnel_url: 'https://updated-sys2.trycloudflare.com'
    })
  });
  assert.strictEqual(gossipRes.statusCode, 200);
  const gossipData = JSON.parse(gossipRes.body);
  assert(gossipData.success === true);
  assert(gossipData.gossip_acknowledged === true);
  console.log(`  ✅ Tree Gossip synchronized: ${gossipData.mesh_peers.length} active peer systems returned`);

  // TEST 8: Leaf Alias Resolution in Sibling Failover
  console.log('\n[TEST 8] Testing Leaf Alias Resolution (DESKTOP-SYSTEM-01-leaf12 -> Worker)...');
  const resolvedWs = serverModule.getAgentSocket('DESKTOP-SYSTEM-01-leaf12');
  assert(resolvedWs, 'Should resolve leaf alias socket');
  assert.strictEqual(resolvedWs.readyState, WebSocket.OPEN);
  console.log('  ✅ Leaf Alias correctly resolved to active WebSocket transport');

  // Clean up sockets
  for (const ws of allSockets) {
    try { ws.close(); } catch (_) {}
  }

  console.log('\n================================================================');
  console.log('🎉 ALL MULTIVERSE TREE MESH TESTS PASSED (1 sys=20, 2 sys=40, 4 sys=80)!');
  console.log('================================================================');
  process.exit(0);
}

runMultiverseTreeTests().catch(err => {
  console.error('❌ Multiverse Tree test failed:', err);
  process.exit(1);
});
