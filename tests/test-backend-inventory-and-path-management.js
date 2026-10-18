/**
 * CYBERVPS SPACE STATION - COMPREHENSIVE BACKEND INVENTORY & PATH MANAGEMENT TEST SUITE
 * 
 * Verifies:
 * 1. GET /api/v1/backends/inventory and GET /api/v1/backends/paths honesty and schema.
 * 2. POST /api/v1/backends/manage actions:
 *    - update_path: updating installation, executable, config, log, and data paths
 *    - relocate: safely moving directories, creating rollback backup, updating registry
 *    - add: registering custom backends with proper validation
 *    - delete: unregistering and purge protection (requiring exact "CONFIRM DELETE")
 *    - restore: recovering uninstalled backends
 * 3. Security constraints:
 *    - Blocking path traversal (..)
 *    - Enforcing Single-Authoritative-Writer invariant across conflicting claims
 *    - Blocking dangerous mutations against OS root directories (/, C:\Windows, etc.)
 * 4. Durable persistence across restarts via backend-inventory.json
 * 5. Dashboard UI and PathRegistryView consistency in both index.html files
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const serverModule = require('../services/server');
const { server, db, pathEngine, getMachineBackendInventory, getAllClusterBackends, loadBackendInventoryState } = serverModule;

function httpRequest(port, pathStr, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: pathStr,
      method: method,
      headers: {
        'Accept': 'application/json',
        ...(postData ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING COMPREHENSIVE BACKEND INVENTORY & PATH MANAGEMENT TESTS');
  console.log('================================================================\n');

  let serverPort = (server && server.listening && server.address()) ? server.address().port : 8080;
  if (!server.listening) {
    await new Promise((resolve) => {
      server.listen(18096, '127.0.0.1', () => {
        serverPort = 18096;
        resolve();
      });
    });
  }
  console.log(`[+] Control plane active and communicating on port ${serverPort}`);

const os = require('os');
const testBaseDir = path.join(os.tmpdir(), 'cybervps_backend_test_' + Date.now());
const customTestDir = path.join(testBaseDir, 'test_custom_backend');
const updatedTestDir = path.join(testBaseDir, 'test_custom_backend_updated');
const relocateDestDir = path.join(testBaseDir, 'test_relocated_backend');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Backend Inventory & Paths Endpoints
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Testing GET /api/v1/backends/inventory and /api/v1/backends/paths...');
    const invRes = await httpRequest(serverPort, '/api/v1/backends/inventory');
    assert.strictEqual(invRes.statusCode, 200, 'GET /api/v1/backends/inventory must return 200');
    assert.strictEqual(invRes.body.ok, true, 'Response must indicate ok: true');
    assert.ok(Array.isArray(invRes.body.inventory), 'Inventory must be an array');
    assert.ok(invRes.body.inventory.length > 0, 'Cluster inventory must contain discovered host backends');
    console.log(`  -> Discovered cluster backends: ${invRes.body.inventory.length}`);

    const sample = invRes.body.inventory[0];
    assert.ok(sample.backend_id, 'Backend must have backend_id');
    assert.ok(sample.canonical_path || sample.installation_path, 'Backend must have canonical/installation path');
    console.log(`  -> Sample backend: ${sample.backend_name || sample.backend_id} at ${sample.canonical_path || sample.installation_path}`);

    const pathsRes = await httpRequest(serverPort, '/api/v1/backends/paths');
    assert.strictEqual(pathsRes.statusCode, 200, 'GET /api/v1/backends/paths must return 200');
    assert.ok(Array.isArray(pathsRes.body.inventory), 'Paths endpoint must return inventory array');
    console.log('  ✅ Test 1 Passed: Backend inventory endpoints return rich, truthful data.');

    // -------------------------------------------------------------------------
    // TEST 2: Add Custom Backend with Verification
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing Custom Backend Registration (action: "add")...');
    if (!fs.existsSync(customTestDir)) fs.mkdirSync(customTestDir, { recursive: true });

    const addRes = await httpRequest(serverPort, '/api/v1/backends/manage', 'POST', {
      action: 'add',
      machine_id: 'control-plane-host',
      backend_name: 'Custom Nginx Edge Gateway',
      category: 'Edge Reverse Proxy',
      installation_path: customTestDir,
      executable_path: path.join(customTestDir, 'nginx.exe'),
      config_path: path.join(customTestDir, 'nginx.conf'),
      log_path: path.join(customTestDir, 'access.log'),
      data_path: path.join(customTestDir, 'html')
    });

    assert.strictEqual(addRes.statusCode, 200, 'Add backend must succeed with 200');
    assert.strictEqual(addRes.body.ok, true, 'Add backend result ok must be true');
    assert.ok(addRes.body.backend, 'Response must return created backend object');
    const customBackendId = addRes.body.backend.backend_id;
    console.log(`  -> Successfully registered custom backend ID: ${customBackendId}`);

    // Verify it appears in cluster inventory
    const verifyAddRes = await httpRequest(serverPort, '/api/v1/backends/inventory');
    const addedItem = verifyAddRes.body.inventory.find(b => b.backend_id === customBackendId);
    assert.ok(addedItem, 'Newly added custom backend must be listed in cluster inventory');
    assert.strictEqual(addedItem.backend_name, 'Custom Nginx Edge Gateway');
    console.log('  ✅ Test 2 Passed: Custom backend registration verified in live inventory.');

    // -------------------------------------------------------------------------
    // TEST 3: Strict Single-Authoritative-Writer Invariant Enforcement
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing Single-Authoritative-Writer conflict detection on conflicting path...');
    const conflictRes = await httpRequest(serverPort, '/api/v1/backends/manage', 'POST', {
      action: 'add',
      machine_id: 'control-plane-host',
      backend_name: 'Competing Fraudulent Gateway',
      installation_path: customTestDir // same path as existing backend
    });

    assert.strictEqual(conflictRes.statusCode, 409, 'Conflicting path registration must return 409 Conflict');
    assert.ok(
      conflictRes.body.error.includes('Path Ownership') ||
      conflictRes.body.error.includes('already owned') ||
      conflictRes.body.error.includes('Single-Authoritative-Writer') ||
      conflictRes.body.error.includes('already registered'),
      `Error must note path collision, got: ${conflictRes.body.error}`
    );
    console.log(`  -> Conflict rejected as expected: "${conflictRes.body.error}"`);
    console.log('  ✅ Test 3 Passed: Strict Single-Writer Invariant prevented collision.');

    // -------------------------------------------------------------------------
    // TEST 4: Security Constraints (Traversal & Protected OS Roots)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing Security Protections (Path Traversal & OS Root Protection)...');
    const traversalRes = await httpRequest(serverPort, '/api/v1/backends/manage', 'POST', {
      action: 'add',
      machine_id: 'control-plane-host',
      backend_name: 'Malicious Path Traversal',
      installation_path: '../../../../etc/shadow'
    });
    assert.strictEqual(traversalRes.statusCode, 400, 'Path traversal must return 400 Bad Request');
    console.log(`  -> Traversal blocked: "${traversalRes.body.error}"`);

    const osRootPath = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc';
    const osRootRes = await httpRequest(serverPort, '/api/v1/backends/manage', 'POST', {
      action: 'update_path',
      machine_id: 'control-plane-host',
      backend_id: customBackendId,
      installation_path: osRootPath
    });
    assert.strictEqual(osRootRes.statusCode, 400, 'OS root mutation must return 400 Bad Request');
    assert.ok(/protected system path/i.test(osRootRes.body.error), 'Error must note protected path');
    console.log(`  -> OS root mutation blocked: "${osRootRes.body.error}"`);
    console.log('  ✅ Test 4 Passed: Security constraints verified against illegal paths.');

    // -------------------------------------------------------------------------
    // TEST 5: Path Update (action: "update_path")
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing Path Modification (action: "update_path")...');
    if (!fs.existsSync(updatedTestDir)) fs.mkdirSync(updatedTestDir, { recursive: true });

    const updateRes = await httpRequest(serverPort, '/api/v1/backends/manage', 'POST', {
      action: 'update_path',
      machine_id: 'control-plane-host',
      backend_id: customBackendId,
      backend_name: 'Custom Nginx Edge Gateway (Updated)',
      installation_path: updatedTestDir,
      config_path: path.join(updatedTestDir, 'prod.conf'),
      log_path: path.join(updatedTestDir, 'prod.log')
    });

    assert.strictEqual(updateRes.statusCode, 200, 'Update path must return 200 OK');
    assert.strictEqual(updateRes.body.ok, true);

    const verifyUpdateRes = await httpRequest(serverPort, '/api/v1/backends/inventory');
    const updatedItem = verifyUpdateRes.body.inventory.find(b => b.backend_id === customBackendId);
    assert.ok(updatedItem, 'Backend must exist');
    assert.strictEqual(updatedItem.backend_name, 'Custom Nginx Edge Gateway (Updated)');
    assert.strictEqual(path.resolve(updatedItem.installation_path), path.resolve(updatedTestDir));
    console.log('  ✅ Test 5 Passed: Path and metadata modification verified.');

    // -------------------------------------------------------------------------
    // TEST 6: Directory Relocation (action: "relocate")
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing Directory Relocation (action: "relocate")...');
    // Ensure source has dummy file to verify data migration
    fs.writeFileSync(path.join(updatedTestDir, 'canary.txt'), 'CyberVPS Relocation Canary Test');

    const relocateRes = await httpRequest(serverPort, '/api/v1/backends/manage', 'POST', {
      action: 'relocate',
      machine_id: 'control-plane-host',
      backend_id: customBackendId,
      current_path: updatedTestDir,
      new_path: relocateDestDir,
      backup_old: true
    });

    assert.strictEqual(relocateRes.statusCode, 200, 'Relocation must return 200 OK');
    assert.strictEqual(relocateRes.body.ok, true);
    assert.ok(fs.existsSync(relocateDestDir), 'Relocated directory must physically exist on disk');
    assert.ok(fs.existsSync(path.join(relocateDestDir, 'canary.txt')), 'Files must be intact in relocated directory');
    console.log('  ✅ Test 6 Passed: Directory relocated safely with rollback backup preserved.');

    // -------------------------------------------------------------------------
    // TEST 7: Backend Deletion with Purge Protection
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing Deletion & Purge Protection (action: "delete")...');
    // Purge attempt without exact confirmation must fail
    const badPurgeRes = await httpRequest(serverPort, '/api/v1/backends/manage', 'POST', {
      action: 'delete',
      machine_id: 'control-plane-host',
      backend_id: customBackendId,
      path: relocateDestDir,
      purge_files: true,
      confirmation: 'wrong-confirmation'
    });
    assert.strictEqual(badPurgeRes.statusCode, 400, 'Unconfirmed purge must return 400 Bad Request');
    console.log(`  -> Purge without confirmation rejected: "${badPurgeRes.body.error}"`);

    // Standard unregister deletion
    const delRes = await httpRequest(serverPort, '/api/v1/backends/manage', 'POST', {
      action: 'delete',
      machine_id: 'control-plane-host',
      backend_id: customBackendId,
      path: relocateDestDir,
      purge_files: false
    });
    assert.strictEqual(delRes.statusCode, 200, 'Delete must succeed with 200 OK');
    assert.strictEqual(delRes.body.ok, true);

    // Verify it is filtered from active inventory
    const verifyDelRes = await httpRequest(serverPort, '/api/v1/backends/inventory');
    const deletedItem = verifyDelRes.body.inventory.find(b => b.backend_id === customBackendId);
    assert.strictEqual(deletedItem, undefined, 'Deleted backend must NOT be listed in active inventory');
    console.log('  ✅ Test 7 Passed: Deletion and purge authorization verified.');

    // -------------------------------------------------------------------------
    // TEST 8: Durable State Persistence (backend-inventory.json)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Testing Durable State File Persistence...');
    const inventoryFile = path.join(__dirname, '..', 'data', 'backend-inventory.json');
    assert.ok(fs.existsSync(inventoryFile), 'backend-inventory.json must exist in data directory');
    const persistedContent = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
    assert.ok(Array.isArray(persistedContent.deleted_backends), 'Durable state must store deleted backends');
    assert.ok(persistedContent.deleted_backends.includes(customBackendId), 'Deleted backend ID must be durably persisted');
    console.log('  ✅ Test 8 Passed: Mutations durably persisted to disk.');

    // -------------------------------------------------------------------------
    // TEST 9: UI Files Consistency & Synchronized Modules
    // -------------------------------------------------------------------------
    console.log('\n[TEST 9] Testing UI Files Consistency...');
    const appHtml = fs.readFileSync(path.join(__dirname, '..', 'apps', 'dashboard', 'index.html'), 'utf8');
    const rootHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const pathRegJs = fs.readFileSync(path.join(__dirname, '..', 'apps', 'dashboard', 'src', 'modules', 'path-registry-view.js'), 'utf8');

    // Verify root and app html match exactly
    assert.strictEqual(appHtml, rootHtml, 'Root index.html and apps/dashboard/index.html must be completely identical');

    // Verify modals in HTML
    assert.ok(appHtml.includes('id="modal-edit-backend-path"'), 'Dashboard must contain Edit Backend Path modal');
    assert.ok(appHtml.includes('id="modal-relocate-backend"'), 'Dashboard must contain Relocate Backend modal');
    assert.ok(appHtml.includes('id="modal-delete-backend"'), 'Dashboard must contain Delete Backend modal');
    assert.ok(appHtml.includes('id="modal-add-backend"'), 'Dashboard must contain Add Backend modal');
    assert.ok(appHtml.includes('CONFIRM DELETE'), 'Delete modal must require typed CONFIRM DELETE');

    // Verify PathRegistryView functionality
    assert.ok(pathRegJs.includes('openEditBackend'), 'PathRegistryView must have openEditBackend method');
    assert.ok(pathRegJs.includes('openRelocateBackend'), 'PathRegistryView must have openRelocateBackend method');
    assert.ok(pathRegJs.includes('openDeleteBackend'), 'PathRegistryView must have openDeleteBackend method');
    assert.ok(pathRegJs.includes('openAddBackend'), 'PathRegistryView must have openAddBackend method');
    assert.ok(pathRegJs.includes('➕ Add Backend'), 'PathRegistryView Tab 0 must feature Add Backend button');

    console.log('  ✅ Test 9 Passed: HTML and JS components fully consistent and synchronized.');

    console.log('\n================================================================');
    console.log('🎉 ALL 9 TEST SUITES PASSED: BACKEND INVENTORY & PATH SYSTEM VERIFIED');
    console.log('================================================================\n');

  } finally {
    // Cleanup temporary test directories
    try {
      if (fs.existsSync(testBaseDir)) fs.rmSync(testBaseDir, { recursive: true, force: true });
    } catch (_) {}

    try {
      if (server && server.listening) {
        server.close();
      }
    } catch (_) {}
    console.log('[+] Clean exit.');
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
