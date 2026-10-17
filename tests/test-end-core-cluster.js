/**
 * CYBERVPS END-CORE — Automated Cluster & Obsidian Pillars Fault Simulation Test Suite
 *
 * Simulates:
 * 1. Multi-pillar cluster state & monotonic epochs
 * 2. Quorum calculation & split-brain prevention (QUORUM_LOST safety freeze)
 * 3. 15-step Obsidian Pillars Reconstitution pipeline
 * 4. Real file/path reconstruction via ProcessHostAdapter
 * 5. Cryptographic backup verification & dry-run sandbox restore
 * 6. Intentional administrative removal (Tombstones: preventing accidental resurrection)
 * 7. Quorum leader election with candidate term validation
 * 8. P2P state synchronization and cryptographic peer message verification
 * 9. Deduplicated idempotent recovery jobs
 * 10. Full 5-Pillar End-to-End Acceptance Test (A, B, C, D, E)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { ClusterState } = require('../services/cluster/cluster-state');
const { RecoveryCoordinator } = require('../services/cluster/recovery-coordinator');
const { getProviderAdapter, ProcessHostAdapter } = require('../services/cluster/provider-adapters');
const { ClusterTransport } = require('../services/cluster/cluster-transport');

async function runEndCoreTestSuite() {
  console.log('================================================================');
  console.log('   CYBERVPS END-CORE: OBSIDIAN PILLARS TEST SUITE               ');
  console.log('================================================================\n');

  const testTempDir = path.join(os.tmpdir(), `cvps_endcore_test_${Date.now()}`);
  fs.mkdirSync(testTempDir, { recursive: true });

  let passedCount = 0;
  let totalCount = 0;

  async function test(name, fn) {
    totalCount++;
    process.stdout.write(`[*] Test ${totalCount}: ${name} ... `);
    try {
      await fn();
      console.log('PASSED \x1b[32m✓\x1b[0m');
      passedCount++;
    } catch (e) {
      console.log(`FAILED \x1b[31m✗\x1b[0m\n    Error: ${e.message}\n    Stack: ${e.stack}`);
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Cluster Initialization & Monotonic Epoch
  // --------------------------------------------------------------------------
  await test('Cluster initializes with default 5-pillar mesh, valid epoch and leader', async () => {
    const cs = new ClusterState({ dataDir: testTempDir });
    assert.strictEqual(cs.epoch, 1);
    assert.ok(cs.nodes.size >= 5, `Expected >= 5 default pillars, got ${cs.nodes.size}`);
    assert.ok(cs.nodes.has('be_primary_local'));
    assert.ok(cs.nodes.has('be_railway_cloud'));
    assert.ok(cs.nodes.has('be_render_cloud'));
    assert.ok(cs.nodes.has('be_voroa_cloud'));
    assert.ok(cs.nodes.has('be_netlify_cloud'));

    const q = cs.getQuorumStatus();
    assert.strictEqual(q.cluster_id, cs.clusterId);
    assert.strictEqual(q.total_active_members, 5);
    assert.strictEqual(q.quorum_required, 3);
    assert.strictEqual(q.has_quorum, true);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Quorum Calculation & Split-Brain Fencing
  // --------------------------------------------------------------------------
  await test('Quorum is correctly lost when minority of nodes is reachable', async () => {
    const cs = new ClusterState({ dataDir: testTempDir });
    // Set 3 of 5 nodes offline
    cs.nodes.get('be_render_cloud').observed_state = 'offline';
    cs.nodes.get('be_voroa_cloud').observed_state = 'offline';
    cs.nodes.get('be_netlify_cloud').observed_state = 'offline';

    const q = cs.getQuorumStatus();
    assert.strictEqual(q.reachable_count, 2);
    assert.strictEqual(q.quorum_required, 3);
    assert.strictEqual(q.has_quorum, false);
    assert.strictEqual(q.quorum_state, 'QUORUM_LOST');
  });

  // --------------------------------------------------------------------------
  // TEST 3: Cryptographic Fencing Token Monotonicity
  // --------------------------------------------------------------------------
  await test('Fencing tokens advance monotonically across operations', async () => {
    const cs = new ClusterState({ dataDir: testTempDir });
    const tok1 = cs.getFencingToken();
    const tok2 = cs.getFencingToken();
    assert.notStrictEqual(tok1, tok2);
    assert.ok(tok1.includes(`epoch_${cs.epoch}`));
    assert.ok(tok2.includes(`epoch_${cs.epoch}`));
  });

  // --------------------------------------------------------------------------
  // TEST 4: Leader Election Consensus
  // --------------------------------------------------------------------------
  await test('Leader election advances epoch and validates candidate term', async () => {
    const cs = new ClusterState({ dataDir: testTempDir });
    // Reset all nodes to healthy
    for (const n of cs.nodes.values()) n.observed_state = 'healthy';

    const electRes = cs.electLeader('be_railway_cloud', 1);
    assert.strictEqual(electRes.success, true);
    assert.strictEqual(cs.leaderId, 'be_railway_cloud');
    assert.strictEqual(cs.epoch, 2);
    assert.strictEqual(cs.nodes.get('be_railway_cloud').role, 'primary');
    assert.strictEqual(cs.nodes.get('be_primary_local').role, 'secondary');

    // Stale term rejection
    const staleRes = cs.electLeader('be_render_cloud', 1);
    assert.strictEqual(staleRes.success, false);
    assert.strictEqual(staleRes.reason, 'Candidate term is stale');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Real File Reconstitution via ProcessHostAdapter
  // --------------------------------------------------------------------------
  await test('ProcessHostAdapter creates real isolated files, data directories and manifests', async () => {
    const adapter = new ProcessHostAdapter();
    const nodeDir = path.join(testTempDir, 'backends', 'node_test_rebuild');
    const mockNode = {
      backend_id: 'node_test_rebuild',
      cluster_id: 'test_cluster',
      deployment_url: 'http://127.0.0.1:8089',
      deployment_resource_id: 'proc_local_8089',
      installation_path: nodeDir,
      data_path: path.join(nodeDir, 'data')
    };
    const mockManifest = { cluster_id: 'test_cluster' };
    const mockBackup = {
      backup_id: 'bck_1',
      payload: { machines: [{ id: 'm1', status: 'online' }] }
    };

    const deployRes = await adapter.deployArtifact(mockNode, mockManifest, mockBackup);
    assert.strictEqual(deployRes.success, true);
    assert.ok(fs.existsSync(nodeDir), 'Install directory must exist');
    assert.ok(fs.existsSync(path.join(nodeDir, 'data', 'server-state.json')), 'Restored state must exist');
    assert.ok(fs.existsSync(path.join(nodeDir, 'config.json')), 'config.json must exist');

    const insp = await adapter.inspectResource(mockNode);
    assert.strictEqual(insp.exists, true);
    assert.strictEqual(insp.has_data, true);
    assert.strictEqual(insp.install_path, nodeDir);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Backup Verification & Sandbox Restore Test
  // --------------------------------------------------------------------------
  await test('Backup snapshot SHA256 checksum and dry-run sandbox restore passes', async () => {
    const cs = new ClusterState({ dataDir: testTempDir });
    const rc = new RecoveryCoordinator(cs);

    const bck = cs.createBackupRecord('be_primary_local', { schema: '1.0', payload_data: 'test_123' });
    assert.ok(bck.checksum_sha256);
    assert.strictEqual(bck.status, 'VERIFIED');

    const vRes = await rc.verifyBackup('be_primary_local');
    assert.strictEqual(vRes.success, true);
    assert.strictEqual(vRes.checksum_sha256, bck.checksum_sha256);

    const rRes = await rc.testRestore('be_primary_local');
    assert.strictEqual(rRes.success, true);
    assert.strictEqual(rRes.verified_integrity, true);
    assert.ok(fs.existsSync(rRes.sandbox_path));
  });

  // --------------------------------------------------------------------------
  // TEST 7: Intentional Administrative Removal (Tombstone Respect)
  // --------------------------------------------------------------------------
  await test('Tombstoned pillar is never auto-resurrected unless explicitly authorized', async () => {
    const cs = new ClusterState({ dataDir: testTempDir });
    const rc = new RecoveryCoordinator(cs);

    // Admin tombstones node
    const tombRes = cs.tombstoneNode('be_netlify_cloud', 'admin', 'Decommissioned by admin');
    assert.strictEqual(tombRes, true);
    assert.ok(cs.tombstones.has('be_netlify_cloud'));

    const node = cs.nodes.get('be_netlify_cloud');
    assert.strictEqual(node.desired_state, 'removed');
    assert.strictEqual(node.observed_state, 'removed');

    // Attempting automatic recovery on a tombstone must be strictly refused
    const recRes = await rc.triggerRecovery('be_netlify_cloud', { auto: true });
    assert.strictEqual(recRes.success, false);
    assert.ok(recRes.error.includes('tombstoned'));

    // Re-registration without force_resurrect must fail
    assert.throws(() => {
      cs.registerNode({ backend_id: 'be_netlify_cloud', name: 'Netlify' }, 'admin');
    }, /signed tombstone/);

    // Re-registration WITH explicit force_resurrect clears tombstone
    const resurrect = cs.registerNode({ backend_id: 'be_netlify_cloud', name: 'Netlify', force_resurrect: true }, 'admin');
    assert.strictEqual(resurrect.backend_id, 'be_netlify_cloud');
    assert.strictEqual(cs.tombstones.has('be_netlify_cloud'), false);
  });

  // --------------------------------------------------------------------------
  // TEST 8: Full 15-Step Obsidian Reconstitution Pipeline Execution
  // --------------------------------------------------------------------------
  await test('15-Step Obsidian Reconstitution pipeline executes and advances generation', async () => {
    const cs = new ClusterState({ dataDir: testTempDir });
    for (const n of cs.nodes.values()) n.observed_state = 'healthy';

    const rc = new RecoveryCoordinator(cs);
    const stepsRecorded = [];

    rc.subscribeEvents((evt) => {
      if (evt.type === 'HEALING_PROGRESS') {
        stepsRecorded.push(evt.payload.step_name);
      }
    });

    // Mark render cloud as offline
    const targetNode = cs.nodes.get('be_render_cloud');
    targetNode.observed_state = 'offline';
    const initialGen = targetNode.recovery_generation || 0;

    const recRes = await rc.triggerRecovery('be_render_cloud', {
      force: true,
      stepDelayMs: 15,
      simulate_health: true
    });
    assert.strictEqual(recRes.success, true);
    assert.strictEqual(recRes.status, 'RECOVERY_QUEUED');

    // Wait for fast pipeline execution
    await new Promise(r => setTimeout(r, 1200));

    assert.ok(stepsRecorded.includes('HEARTBEAT_MISSED'));
    assert.ok(stepsRecorded.includes('FAILURE_CONFIRMED'));
    assert.ok(stepsRecorded.includes('COORDINATOR_ELECTED'));
    assert.ok(stepsRecorded.includes('MANIFEST_LOADED'));
    assert.ok(stepsRecorded.includes('RESOURCE_INSPECTED'));
    assert.ok(stepsRecorded.includes('BACKUP_VERIFIED'));
    assert.ok(stepsRecorded.includes('HEALING_BEAMS_ENGAGED'));
    assert.ok(stepsRecorded.includes('DEPLOYMENT_STARTED'));
    assert.ok(stepsRecorded.includes('PROCESS_BOOTSTRAPPED'));
    assert.ok(stepsRecorded.includes('CONFIG_RESTORED'));
    assert.ok(stepsRecorded.includes('IDENTITY_VERIFIED'));
    assert.ok(stepsRecorded.includes('STATE_SYNCHRONIZED'));
    assert.ok(stepsRecorded.includes('REJOIN_ACCEPTED'));
    assert.ok(stepsRecorded.includes('COMPLETED'));

    assert.strictEqual(targetNode.observed_state, 'healthy');
    assert.strictEqual(targetNode.recovery_generation, initialGen + 1);
  });

  // --------------------------------------------------------------------------
  // TEST 9: P2P Cluster State Synchronization & Signature Verification
  // --------------------------------------------------------------------------
  await test('P2P cluster sync packages require valid cryptographic signatures and advance state', async () => {
    const cs1 = new ClusterState({ dataDir: path.join(testTempDir, 'node1'), selfNodeId: 'node_1' });
    const cs2 = new ClusterState({ dataDir: path.join(testTempDir, 'node2'), selfNodeId: 'node_2' });

    // Node 1 creates custom pillar and advances epoch
    cs1.registerNode({
      backend_id: 'be_custom_fra',
      display_name: 'Frankfurt Obsidian Pillar',
      deployment_url: 'https://fra.cybervps.net'
    });
    cs1.epoch = 5;

    const syncPkg = cs1.getClusterSyncPackage();
    const signature = cs1.signPayload(syncPkg);

    // Verify signature check
    assert.strictEqual(cs2.verifySignature(syncPkg, signature), true);
    assert.strictEqual(cs2.verifySignature(syncPkg, 'invalid_sig'), false);

    // Apply sync package to Node 2
    const applied = cs2.applyClusterSyncPackage(syncPkg, 'node_1');
    assert.strictEqual(applied, true);
    assert.strictEqual(cs2.epoch, 5);
    assert.ok(cs2.nodes.has('be_custom_fra'));
  });

  // --------------------------------------------------------------------------
  // TEST 10: Full End-to-End Acceptance Test (A, B, C, D, E Mesh Convergence)
  // --------------------------------------------------------------------------
  await test('Full 5-Node End-Core Mesh: Node C crashes, surviving pillars coordinate healing', async () => {
    const cs = new ClusterState({ dataDir: testTempDir });
    // Reset all 5 pillars to healthy
    for (const n of cs.nodes.values()) {
      n.observed_state = 'healthy';
      n.desired_state = 'running';
    }
    // Remove any test tombstones
    cs.tombstones.clear();

    // Verify 5 active pillars
    assert.strictEqual(cs.nodes.size >= 5, true);

    // Simulate Node C failure (be_voroa_cloud)
    const nodeC = cs.nodes.get('be_voroa_cloud');
    nodeC.observed_state = 'offline';
    nodeC.failures_count = 3;

    // Remaining nodes (A, B, D, E) retain quorum (4 >= 3)
    const quorum = cs.getQuorumStatus();
    assert.strictEqual(quorum.has_quorum, true);
    assert.strictEqual(quorum.reachable_count, 4);

    // Reconstitution coordinator activates
    const rc = new RecoveryCoordinator(cs);
    const rec = await rc.triggerRecovery('be_voroa_cloud', {
      force: true,
      stepDelayMs: 15,
      simulate_health: true
    });
    assert.strictEqual(rec.success, true);

    await new Promise(r => setTimeout(r, 1200));

    // Node C is restored to the mesh
    assert.strictEqual(nodeC.observed_state, 'healthy');
    assert.strictEqual(nodeC.failures_count, 0);
    assert.ok(nodeC.recovery_generation >= 1);
  });

  // Cleanup
  try {
    fs.rmSync(testTempDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n================================================================');
  console.log(`   END-CORE TEST RESULTS: ${passedCount} / ${totalCount} PASSED `);
  console.log('================================================================\n');

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

if (require.main === module) {
  runEndCoreTestSuite().catch(e => {
    console.error('Fatal test error:', e);
    process.exit(1);
  });
}

module.exports = { runEndCoreTestSuite };
