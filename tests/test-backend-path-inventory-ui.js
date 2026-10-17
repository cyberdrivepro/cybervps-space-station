/**
 * CYBERVPS SPACE STATION - DEVICE INTELLIGENCE BACKEND PATH INVENTORY &
 * PHYSICAL TOPOLOGY VERIFICATION SUITE
 * 
 * Verifies:
 * 1. Agent universal backend & physical path extraction via universal-agent.py
 * 2. Real physical path verification on disk (os.path.exists) - no hardcoded /app
 * 3. Server profile API (/api/v1/machines/:id/profile) returns backend_inventory & non-empty attributes
 * 4. Dedicated machine backend endpoints (/api/v1/machines/:id/backends & /scan-inventory)
 * 5. Cluster-wide physical inventory endpoint (/api/v1/backends/inventory) with single-writer invariant
 * 6. Single-Authoritative-Writer invariant and Obsidian Ring failover replica destination
 * 7. Truthful network reporting (Behind NAT vs Gateway & Loopback Interface)
 * 8. Frontend HTML & JS synchronization in both apps/dashboard/index.html and index.html
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const serverModule = require('../services/server');
const { server, db, pathEngine, getMachineBackendInventory, getAllClusterBackends } = serverModule;

const TEST_PORT = 18095;
let baseUrl = `http://127.0.0.1:${TEST_PORT}`;

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (postData) {
      if (typeof postData === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(postData));
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING DEVICE INTELLIGENCE & BACKEND PATH INVENTORY TEST SUITE');
  console.log('================================================================\n');

  // Use active server port or start if needed
  let serverPort = (server && server.listening && server.address()) ? server.address().port : TEST_PORT;
  if (!server.listening) {
    await new Promise((resolve) => {
      server.listen(TEST_PORT, '127.0.0.1', () => {
        serverPort = TEST_PORT;
        resolve();
      });
    });
  }
  console.log(`[+] Test suite communicating with control plane on port ${serverPort}`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Agent Universal Backend & Physical Path Extraction (Python Subprocess)
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Testing Agent Universal Backend & Physical Path Extraction via Python...');
    const pythonCode = `
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location('agent', 'agent/universal-agent.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
agent = mod.CyberVPSAgent('http://localhost:' + str(${serverPort}))
inv = agent.get_backend_inventory()
rpaths = agent.get_runtime_paths()
profile = agent.discover_device_profile()
print(json.dumps({
    'inventory': inv,
    'runtime_paths': rpaths,
    'attributes': profile.get('attributes', {})
}))
`;
    const pyResult = spawnSync('python', ['-c', pythonCode], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 10000
    });

    assert.strictEqual(pyResult.status, 0, `Python agent execution failed: ${pyResult.stderr}`);
    const pyData = JSON.parse(pyResult.stdout.trim());
    assert(Array.isArray(pyData.inventory), 'Agent inventory must be an array');
    assert(pyData.inventory.length >= 1, 'Agent inventory must contain at least 1 backend');

    const agentBackend = pyData.inventory[0];
    console.log(`  -> Detected Agent Backend: ${agentBackend.backend_name}`);
    console.log(`  -> Physical Installation Path: ${agentBackend.installation_path}`);
    console.log(`  -> Executable Path: ${agentBackend.executable_path}`);
    console.log(`  -> Verification Status: ${agentBackend.verification_status}`);

    assert(agentBackend.backend_id.startsWith('be_agent_'), 'Backend ID must have prefix be_agent_');
    assert.strictEqual(agentBackend.verification_status, 'verified_on_disk', 'Path must be physically verified on disk');
    assert(fs.existsSync(agentBackend.installation_path), 'Reported installation path must physically exist on host');
    assert(agentBackend.installation_path !== '/app', 'Installation path must NOT be a guessed /app path');
    assert.strictEqual(agentBackend.single_writer_enforced, true, 'Single-writer invariant must be enforced');
    assert(agentBackend.obsidian_mesh_pillar.includes('Pillar'), 'Obsidian ring pillar must be assigned');
    assert(agentBackend.failover_replica_path.length > 0, 'Failover standby replica path must be specified');

    // Verify discovered attributes contain path attributes
    assert(pyData.attributes['node:installDir'], 'node:installDir attribute must be present');
    assert(pyData.attributes['node:executablePath'], 'node:executablePath attribute must be present');
    assert.strictEqual(pyData.attributes['node:singleWriterEnforced'], 'true', 'node:singleWriterEnforced must be true');
    console.log('  ✅ Test 1 Passed: Agent physical paths verified truthfully on host disk.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Server Profile API (/api/v1/machines/:id/profile) with Inventory & Attributes
    // -------------------------------------------------------------------------
    console.log('[TEST 2] Testing Server Machine Profile API with Backend Inventory and Attributes...');
    const testMachineId = 'cvps_desktop01cs69v_testnode1';
    db.machines.set(testMachineId, {
      id: testMachineId,
      hostname: 'DESKTOP-01CS69V',
      friendly_name: 'DESKTOP-01CS69V-Worker',
      username: 'Suraj',
      os: 'Windows',
      os_version: 'Windows 10 Pro 22H2 (Build 19045.6466)',
      arch: 'x86_64',
      status: 'online',
      virtual_ip: '10.77.0.4',
      last_seen: new Date().toISOString(),
      runtime_paths: pyData.runtime_paths,
      backend_inventory: pyData.inventory,
      profile: {
        attributes: pyData.attributes
      }
    });

    const profRes = await httpRequest({
      hostname: '127.0.0.1',
      port: serverPort,
      path: `/api/v1/machines/${testMachineId}/profile`,
      method: 'GET'
    });

    assert.strictEqual(profRes.statusCode, 200, 'Profile endpoint must return HTTP 200');
    assert(profRes.body.backend_inventory, 'Response must contain backend_inventory');
    assert(Array.isArray(profRes.body.backend_inventory), 'backend_inventory must be an array');
    assert(profRes.body.backend_inventory.length >= 1, 'Must have at least 1 backend in inventory');

    // Attributes verification: NEVER EMPTY
    assert(profRes.body.attributes, 'Profile attributes must not be null/undefined');
    const attrKeys = Object.keys(profRes.body.attributes);
    assert(attrKeys.length >= 8, `Attributes must be populated with telemetry (found ${attrKeys.length})`);
    assert(profRes.body.attributes['node:backendId'], 'node:backendId must be present');
    assert(profRes.body.attributes['node:installDir'], 'node:installDir must be present');
    assert(profRes.body.attributes['node:singleWriterEnforced'], 'node:singleWriterEnforced must be present');
    assert(profRes.body.all_cluster_backends, 'all_cluster_backends must be present in profile');

    console.log(`  -> Profile returned ${profRes.body.backend_inventory.length} backends and ${attrKeys.length} discovered node attributes.`);
    console.log('  ✅ Test 2 Passed: Profile API successfully returns full backend inventory and attributes.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Dedicated Machine Backend Endpoints (/backends & /scan-inventory)
    // -------------------------------------------------------------------------
    console.log('[TEST 3] Testing /api/v1/machines/:id/backends and /scan-inventory...');
    const backendsRes = await httpRequest({
      hostname: '127.0.0.1',
      port: serverPort,
      path: `/api/v1/machines/${testMachineId}/backends`,
      method: 'GET'
    });

    assert.strictEqual(backendsRes.statusCode, 200, '/backends must return HTTP 200');
    assert.strictEqual(backendsRes.body.success, true);
    assert.strictEqual(backendsRes.body.single_writer_invariant, 'STRICT_ENFORCED');
    assert(Array.isArray(backendsRes.body.backends));
    assert(backendsRes.body.backends.length >= 1);

    const scanRes = await httpRequest({
      hostname: '127.0.0.1',
      port: serverPort,
      path: `/api/v1/machines/${testMachineId}/scan-inventory`,
      method: 'POST'
    });

    assert.strictEqual(scanRes.statusCode, 200, '/scan-inventory must return HTTP 200');
    assert.strictEqual(scanRes.body.success, true);
    assert(scanRes.body.request_id, 'Scan request must return a request_id');
    console.log(`  -> Scan initiated with Request ID: ${scanRes.body.request_id}`);
    console.log('  ✅ Test 3 Passed: Dedicated backend endpoints functional.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Cluster-wide Backend Inventory Endpoint (/api/v1/backends/inventory)
    // -------------------------------------------------------------------------
    console.log('[TEST 4] Testing Cluster-wide Backend Inventory Endpoint (/api/v1/backends/inventory)...');
    const clusterInvRes = await httpRequest({
      hostname: '127.0.0.1',
      port: serverPort,
      path: `/api/v1/backends/inventory`,
      method: 'GET'
    });

    assert.strictEqual(clusterInvRes.statusCode, 200, '/backends/inventory must return HTTP 200');
    assert.strictEqual(clusterInvRes.body.single_writer_invariant, 'STRICT_ENFORCED');
    assert(Array.isArray(clusterInvRes.body.inventory));
    assert(clusterInvRes.body.inventory.length >= 2, 'Cluster inventory must contain control plane + machines');

    const cpBackend = clusterInvRes.body.inventory.find(b => b.backend_id === 'be_primary_local');
    assert(cpBackend, 'Primary control plane backend must be registered in cluster inventory');
    assert(cpBackend.installation_path, 'Control plane must have installation_path');
    assert(cpBackend.executable_path, 'Control plane must have executable_path');
    assert.strictEqual(cpBackend.verification_status, 'verified_on_disk');
    console.log(`  -> Cluster Inventory count: ${clusterInvRes.body.inventory.length} backends across cluster.`);
    console.log('  ✅ Test 4 Passed: Cluster inventory returns all authoritative physical endpoints.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Single-Authoritative-Writer Path Isolation & Conflict Detection
    // -------------------------------------------------------------------------
    console.log('[TEST 5] Testing Strict Single-Authoritative-Writer Invariant...');
    const sharedPath = path.resolve(__dirname, '../data/test_exclusive_dir');
    if (!fs.existsSync(sharedPath)) fs.mkdirSync(sharedPath, { recursive: true });

    // Register primary backend
    await pathEngine.registerPathOwnership({
      machine_id: testMachineId,
      path: sharedPath,
      backend_id: 'be_agent_primary_writer',
      ownership_role: 'primary',
      resource_type: 'backend'
    });

    // Attempt second primary registration on same path -> Conflict must be logged
    let conflictCaught = false;
    try {
      await pathEngine.registerPathOwnership({
        machine_id: testMachineId,
        path: sharedPath,
        backend_id: 'be_agent_rogue_second_writer',
        ownership_role: 'primary',
        resource_type: 'backend'
      });
    } catch (err) {
      conflictCaught = true;
      console.log(`  -> Conflict correctly rejected by engine: ${err.message}`);
    }

    const activeConflicts = pathEngine.listConflicts(testMachineId);
    assert(conflictCaught || activeConflicts.length > 0, 'Multiple primary writers must trigger conflict or rejection');
    console.log('  ✅ Test 5 Passed: Single-writer path isolation strictly enforced.\n');

    // -------------------------------------------------------------------------
    // TEST 6: Truthful Network Reporting (Behind NAT vs Gateway & Loopback Interface)
    // -------------------------------------------------------------------------
    console.log('[TEST 6] Testing Truthful Network Reporting Logic in UI Scripts...');
    const appsHtml = fs.readFileSync(path.resolve(__dirname, '../apps/dashboard/index.html'), 'utf-8');
    const rootHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');

    assert(appsHtml.includes('Behind NAT (—)'), 'apps/dashboard/index.html must contain Behind NAT reporting');
    assert(rootHtml.includes('Behind NAT (—)'), 'index.html must contain Behind NAT reporting');
    assert(appsHtml.includes('Loopback Interface (127.0.0.1)'), 'apps/dashboard/index.html must identify loopback interface');
    assert(rootHtml.includes('Loopback Interface (127.0.0.1)'), 'index.html must identify loopback interface');
    console.log('  ✅ Test 6 Passed: Truthful network reporting verified in frontend.\n');

    // -------------------------------------------------------------------------
    // TEST 7: Frontend Template & UI Component Verification
    // -------------------------------------------------------------------------
    console.log('[TEST 7] Verifying Backend Path Inventory Components in Dashboard UI...');
    assert(appsHtml.includes('id="backend-paths-inventory-card"'), 'apps/dashboard/index.html must contain #backend-paths-inventory-card');
    assert(rootHtml.includes('id="backend-paths-inventory-card"'), 'index.html must contain #backend-paths-inventory-card');
    assert(appsHtml.includes('renderBackendInventory'), 'apps/dashboard/index.html must define renderBackendInventory');
    assert(rootHtml.includes('renderBackendInventory'), 'index.html must define renderBackendInventory');
    assert(appsHtml.includes('scanSelectedMachineInventory'), 'Live scan function must be present');
    assert(appsHtml.includes('copyBackendPath'), 'Copy path function must be present');
    assert(appsHtml.includes('inspectBackendPath'), 'Inspect in files function must be present');
    assert(appsHtml.includes('exportBackendInventoryJson'), 'Export JSON function must be present');
    assert(appsHtml.includes('obsidian-ring-status-banner'), 'Obsidian ring status banner must be present');
    console.log('  ✅ Test 7 Passed: UI components and interactive controls verified in both HTML files.\n');

    console.log('================================================================');
    console.log('🎉 ALL 7 TESTS PASSED: DEVICE INTELLIGENCE PATH INVENTORY VERIFIED');
    console.log('================================================================\n');

  } finally {
    try {
      if (server && server.listening) {
        server.close();
      }
    } catch (_) {}
    console.log('[+] Test server cleanly terminated.');
    setTimeout(() => process.exit(0), 100);
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('❌ TEST SUITE FAILED:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
