/**
 * CYBERVPS SPACE STATION - PATH OWNERSHIP, RECONCILIATION & TOPOLOGY TEST SUITE
 * Tests Strict Single-Writer Invariant, Path Canonicalization, Network Accuracy (Loopback vs LAN),
 * Deletion/Movement Discovery, Safe Atomic Recovery, and Connection Graph Loop Detection.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const PathOwnershipEngine = require('../services/core/path-ownership-engine');
const ResourceReconciliationService = require('../services/core/resource-reconciliation');
const InfrastructureIntelService = require('../services/core/infrastructure-intel');
const { StorageManager } = require('../services/storage/index');

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING PATH OWNERSHIP, RECONCILIATION & TOPOLOGY TESTS');
  console.log('================================================================');

  const testDir = path.join(__dirname, 'tmp-topology-test');
  const storage = await StorageManager.create({ dataDir: testDir });
  const pathEngine = new PathOwnershipEngine({ storage });
  await pathEngine.init();

  const reconciliationService = new ResourceReconciliationService({ pathEngine, storage });
  const infraIntel = new InfrastructureIntelService({ pathEngine, storage });

  // TEST 1: Network Accuracy - Strict Separation of Loopback vs LAN vs Mesh
  console.log('\n[TEST 1] Testing Network Accuracy: Loopback vs LAN vs Virtual Mesh...');
  const simulatedInterfaces = {
    'lo': [
      { address: '127.0.0.1', family: 'IPv4', internal: true },
      { address: '::1', family: 'IPv6', internal: true }
    ],
    'eth0': [
      { address: '192.168.1.105', family: 'IPv4', internal: false, netmask: '255.255.255.0' }
    ],
    'wg0': [
      { address: '10.77.0.4', family: 'IPv4', internal: false, netmask: '255.255.255.0' }
    ],
    'docker0': [
      { address: '172.17.0.1', family: 'IPv4', internal: false, netmask: '255.255.0.0' }
    ]
  };

  const categorized = infraIntel.categorizeNetworkAddresses(simulatedInterfaces);

  // 127.0.0.1 must NEVER be categorized as LAN
  assert.strictEqual(categorized.loopback_addresses.length, 2, 'Must identify 127.0.0.1 and ::1 as loopback');
  assert(categorized.loopback_addresses.every(a => a.label.includes('Loopback')), 'Loopback must be explicitly labeled');
  assert(!categorized.lan_addresses.some(a => a.address.startsWith('127.')), 'LAN list must never contain 127.0.0.1');

  // True LAN IPv4
  assert.strictEqual(categorized.lan_addresses.length, 1);
  assert.strictEqual(categorized.lan_addresses[0].address, '192.168.1.105');
  assert.strictEqual(categorized.lan_addresses[0].label, 'Local Area Network (LAN)');

  // Virtual Mesh VIP
  assert.strictEqual(categorized.virtual_mesh_addresses.length, 1);
  assert.strictEqual(categorized.virtual_mesh_addresses[0].address, '10.77.0.4');
  assert.strictEqual(categorized.virtual_mesh_addresses[0].label, 'CyberVPS Virtual Mesh');

  console.log('  ✅ Network accuracy verified: 127.0.0.1 strictly isolated as Loopback, LAN (192.168.1.105) and Mesh (10.77.0.4) classified truthfully.');

  // TEST 2: Cross-Platform Path Canonicalization
  console.log('\n[TEST 2] Testing Cross-Platform Path Canonicalization...');
  // Windows paths
  const winCanonical1 = pathEngine.canonicalizePath('c:\\services\\app1\\..\\backend1\\', 'win32');
  assert.strictEqual(winCanonical1, 'C:/services/backend1', 'Windows path must resolve .. and standardize drive letter and slashes');

  const winCanonical2 = pathEngine.canonicalizePath('C:/services/backend1', 'win32');
  assert.strictEqual(winCanonical1, winCanonical2, 'Different representations must resolve to exact identical canonical string');

  // Linux paths
  const linuxCanonical = pathEngine.canonicalizePath('/var/data/../data/./vault/', 'linux');
  assert.strictEqual(linuxCanonical, '/var/data/vault', 'Linux path must resolve .. and . segments');

  // Null byte injection attack
  let threwNullByte = false;
  try {
    pathEngine.canonicalizePath('/safe/path\0/malicious', 'linux');
  } catch (err) {
    threwNullByte = true;
  }
  assert(threwNullByte, 'Null byte character in path must be rejected');
  console.log('  ✅ Path canonicalization verified: Windows & Linux directory normalization and null byte rejection operational.');

  // TEST 3: Strict Single-Authoritative-Writer Invariant Enforcement
  console.log('\n[TEST 3] Testing Strict Single-Authoritative-Writer Invariant...');
  const machineA = 'test_host_alpha_99';
  const sharedPath = 'C:\\CyberVPS\\ClusterBackend1';

  // Primary Writer 1 registers ownership -> Must Succeed (200)
  const claim1 = await pathEngine.registerPathOwnership({
    machine_id: machineA,
    path: sharedPath,
    backend_id: 'backend_pillar_alpha',
    ownership_role: 'primary',
    platform: 'win32'
  });
  assert.strictEqual(claim1.state, 'healthy');
  assert.strictEqual(claim1.ownership_role, 'primary');
  assert(claim1.lease_token.startsWith('lease_'));
  console.log(`  [*] Backend [backend_pillar_alpha] successfully registered authoritative primary ownership of [${claim1.canonical_path}]`);

  // Competing Primary Writer 2 attempts to claim the EXACT same path -> Must be REJECTED with 409 Conflict
  let conflictCaught = false;
  try {
    await pathEngine.registerPathOwnership({
      machine_id: machineA,
      path: sharedPath,
      backend_id: 'competing_backend_beta',
      ownership_role: 'primary',
      platform: 'win32'
    });
  } catch (err) {
    conflictCaught = true;
    assert.strictEqual(err.statusCode, 409, 'Must return 409 Conflict status code');
    assert(err.message.includes('Strict Path Ownership Violation'), 'Must provide descriptive violation error message');
  }
  assert(conflictCaught, 'Second primary writer on the same canonical path must be strictly blocked');

  // Verify conflict was recorded in conflicts table
  const recordedConflicts = pathEngine.listConflicts(machineA);
  assert(recordedConflicts.length >= 1, 'Conflict must be logged in conflicts registry');
  assert.strictEqual(recordedConflicts[0].existing_owner_backend, 'backend_pillar_alpha');
  assert.strictEqual(recordedConflicts[0].competing_owner_backend, 'competing_backend_beta');
  console.log('  ✅ Strict Single-Authoritative-Writer invariant verified: Competing primary writer rejected with 409 Conflict.');

  // Read-only replica on the same path -> Must Succeed (Replicas are read-only)
  const replicaClaim = await pathEngine.registerPathOwnership({
    machine_id: machineA,
    path: sharedPath,
    backend_id: 'replica_backend_mirror',
    ownership_role: 'replica',
    platform: 'win32'
  });
  assert.strictEqual(replicaClaim.ownership_role, 'replica');
  console.log('  ✅ Secondary read-only replica permitted without conflict.');

  // TEST 4: Overlapping Parent/Child Directory Conflict Detection
  console.log('\n[TEST 4] Testing Overlapping Directory Ownership Detection...');
  const linuxHost = 'test_linux_cluster_node';

  // Primary backend 1 claims parent directory: /var/space-station/data
  await pathEngine.registerPathOwnership({
    machine_id: linuxHost,
    path: '/var/space-station/data',
    backend_id: 'primary_storage_controller',
    ownership_role: 'primary',
    platform: 'linux'
  });

  // Primary backend 2 attempts to claim child subdirectory: /var/space-station/data/subnode
  let overlapCaught = false;
  try {
    await pathEngine.registerPathOwnership({
      machine_id: linuxHost,
      path: '/var/space-station/data/subnode',
      backend_id: 'nested_rogue_writer',
      ownership_role: 'primary',
      platform: 'linux'
    });
  } catch (err) {
    overlapCaught = true;
    assert.strictEqual(err.statusCode, 409);
    assert(err.message.includes('Overlapping Directory Ownership Violation'));
  }
  assert(overlapCaught, 'Overlapping nested directory ownership must be rejected');
  console.log('  ✅ Overlapping directory conflict detection verified: Parent/child collision blocked.');

  // TEST 5: Deletion, Movement & Safe Atomic Recovery Workflow
  console.log('\n[TEST 5] Testing Deletion Detection, Candidate Finding & Atomic Safe Recovery...');
  const testResourceId = 'res_resilient_db_01';
  const canonicalOriginal = 'C:/CyberVPS/ProductionDB';

  // Step A: Register primary resource with checksum
  const origResource = await pathEngine.registerPathOwnership({
    resource_id: testResourceId,
    machine_id: machineA,
    path: canonicalOriginal,
    backend_id: 'authoritative_db_master',
    ownership_role: 'primary',
    checksum: 'sha256_hash_golden_master_789456',
    platform: 'win32'
  });

  // Step B: Register a replica on machine B with matching checksum
  const machineB = 'test_host_backup_vault';
  await pathEngine.registerPathOwnership({
    resource_id: 'res_replica_vault_01',
    machine_id: machineB,
    path: 'D:/Backups/ProductionDB_Mirror',
    backend_id: 'vault_replica_daemon',
    ownership_role: 'replica',
    checksum: 'sha256_hash_golden_master_789456',
    platform: 'win32'
  });

  // Step C: Trigger reconciliation scan where canonicalOriginal is missing from filesystem
  // Note: C:/CyberVPS/ClusterBackend1 from TEST 3 is present, but C:/CyberVPS/ProductionDB is missing
  const scanReport = await reconciliationService.scanAndDetect(machineA, ['C:/OtherApp/file.txt', 'C:/CyberVPS/ClusterBackend1']);
  assert.strictEqual(scanReport.missing_count, 1, 'Missing database path must be detected');
  assert.strictEqual(origResource.state, 'missing');
  console.log('  [*] Detected missing resource. State transitioned to [missing].');

  // Step D: Search for valid candidate replacements across cluster
  const candidatesResult = await reconciliationService.findReplacementCandidates(testResourceId);
  assert.strictEqual(candidatesResult.candidates_found, 1, 'Must discover 1 verified candidate replica');
  const bestCandidate = candidatesResult.candidates[0];
  assert.strictEqual(bestCandidate.confidence, 100, 'Checksum match must yield 100% confidence');
  assert.strictEqual(bestCandidate.machine_id, machineB);
  console.log(`  [*] Discovered verified candidate on [${bestCandidate.machine_id}] at [${bestCandidate.canonical_path}]`);

  // Step E: Execute Safe Recovery with authorization
  const destinationPath = 'C:/CyberVPS/RecoveredProductionDB';
  const recoveryResult = await reconciliationService.executeSafeRecovery({
    resource_id: testResourceId,
    candidate_id: bestCandidate.candidate_id,
    destination_path: destinationPath,
    target_machine_id: machineA,
    operator: 'SuperAdmin',
    authorized: true
  });

  assert.strictEqual(recoveryResult.status, 'RECOVERED');
  assert.strictEqual(origResource.state, 'healthy');
  assert.strictEqual(origResource.canonical_path, destinationPath);
  console.log('  ✅ Safe atomic recovery executed: Staged, hash-verified, destination reassigned, state restored to [healthy].');

  // Verify immutable movement history
  const history = await reconciliationService.getResourceHistory(testResourceId);
  assert(history.length >= 2, 'History must contain created and recovered events');
  assert(history.some(e => e.event_type === 'recovered'), 'History must contain recovery event');
  console.log('  ✅ Complete before-and-after history timeline verified.');

  // TEST 6: Connection Topology Graph & Circular Routing Loop Inspector
  console.log('\n[TEST 6] Testing Connection Topology Graph & Circular Routing Loop Inspector...');
  const graph = await infraIntel.buildConnectionGraph();

  assert(graph.nodes.length >= 6, 'Must include Control Plane and 5 Obsidian Pillars');
  assert(graph.summary.obsidian_mesh_healthy, 'Obsidian pillars circle mesh must be healthy');
  assert.strictEqual(graph.summary.routing_loops_count, 0, 'Clean graph must have 0 harmful routing loops');
  console.log(`  ✅ Connection Graph generated: ${graph.nodes.length} nodes, ${graph.edges.length} edges, 0 routing loops.`);

  // Close storage adapter connection so file locks are freed on Windows
  if (storage && typeof storage.close === 'function') {
    await storage.close();
  }

  // Cleanup test files safely
  try {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  } catch (_) {
    // Non-fatal if Windows locks temp directory briefly
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 6 ADVANCED PATH OWNERSHIP & TOPOLOGY TESTS PASSED!');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
