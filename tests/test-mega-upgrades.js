/**
 * CyberVPS Space Station - Mega Upgrades Verification Suite (Test 59)
 * Tests:
 * 1. Prometheus OpenMetrics Exporter (/metrics)
 * 2. Fleet Broadcast Execution Pipeline (/api/v1/fleet/broadcast-exec)
 * 3. Decentralized Cluster State Delta Sync (/api/v1/cluster/sync-delta) & Adjacency Graph (/api/v1/cluster/topology/graph)
 * 4. Automated Hot Disaster Recovery Snapshot & Restore (/api/v1/dr/snapshot, /api/v1/dr/restore)
 * 5. AES-256-GCM Encrypted Secret Vault (/api/v1/vault/secrets)
 * 6. Doctor Service 24-Point Comprehensive Matrix
 */

const http = require('http');
const assert = require('assert');

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8080';

async function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { ...(options.headers || {}) };
    if (!headers['Connection']) headers['Connection'] = 'close';
    if (options.body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(options.body);
    }
    const reqOptions = { agent: false, ...options, headers };
    const req = http.request(u, reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runMegaUpgradesTests() {
  console.log('\n================================================================');
  console.log('⚡ CYBERVPS SPACE STATION - MEGA UPGRADES (TEST 59) VERIFICATION');
  console.log('================================================================\n');

  // TEST 1: Prometheus Metrics Exporter
  console.log('[*] Test 1: Testing Prometheus OpenMetrics Exporter (/metrics)...');
  const metricsRes = await request(`${SERVER_URL}/metrics`);
  assert.strictEqual(metricsRes.statusCode, 200, 'Metrics must return 200 OK');
  assert(metricsRes.headers['content-type'].includes('text/plain'), 'Must serve text/plain metrics');
  const metricsBody = metricsRes.body;
  assert(metricsBody.includes('cybervps_info{version="2.2.0"'), 'Must contain cybervps_info gauge');
  assert(metricsBody.includes('cybervps_active_machines_total'), 'Must contain active machines metric');
  assert(metricsBody.includes('cybervps_active_bridges_total'), 'Must contain active bridges metric');
  assert(metricsBody.includes('cybervps_uptime_seconds'), 'Must contain uptime counter');
  assert(metricsBody.includes('cybervps_doctor_checks_total 24'), 'Must expose 24 doctor checks metric');
  console.log('  ✅ Prometheus OpenMetrics Exporter (/metrics) verified!');

  // TEST 2: Fleet Broadcast Command Execution
  console.log('\n[*] Test 2: Testing Fleet Broadcast Command Pipeline (/api/v1/fleet/broadcast-exec)...');
  const bcastRes = await request(`${SERVER_URL}/api/v1/fleet/broadcast-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'echo "cybervps_fleet_mega_online"',
      args: ['--telemetry', '--broadcast'],
      filter: {}
    })
  });
  assert.strictEqual(bcastRes.statusCode, 200, 'Broadcast endpoint must return 200 OK');
  const bcastData = JSON.parse(bcastRes.body);
  assert.strictEqual(bcastData.success, true);
  assert(bcastData.broadcast_id.startsWith('bcast_'), 'Must return valid broadcast_id');
  assert.strictEqual(typeof bcastData.total_targets, 'number');
  assert.strictEqual(typeof bcastData.successful_count, 'number');
  console.log(`  ✅ Fleet Broadcast Pipeline verified! Broadcast ID: ${bcastData.broadcast_id}, Targets: ${bcastData.total_targets}`);

  // TEST 3: Decentralized Cluster State Delta Sync & Adjacency Graph
  console.log('\n[*] Test 3: Testing Decentralized Cluster State Delta Sync & Topology Graph...');
  const deltaRes = await request(`${SERVER_URL}/api/v1/cluster/sync-delta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin_node_id: 'vps_edge_backend_omega',
      sequence: 42,
      vector_clock: { vps_edge_backend_omega: 42, station_hub: 10 },
      delta: {
        backend: {
          id: 'be_omega_42',
          name: 'Omega Edge Backend',
          url: 'http://10.77.0.42:8080',
          role: 'p2p_mesh_edge',
          status: 'healthy'
        }
      }
    })
  });
  assert.strictEqual(deltaRes.statusCode, 200, 'Sync delta must return 200 OK');
  const deltaData = JSON.parse(deltaRes.body);
  assert.strictEqual(deltaData.success, true);
  assert.strictEqual(deltaData.synchronized, true);
  assert.strictEqual(deltaData.sequence, 42);

  const graphRes = await request(`${SERVER_URL}/api/v1/cluster/topology/graph`);
  assert.strictEqual(graphRes.statusCode, 200, 'Topology graph must return 200 OK');
  const graphData = JSON.parse(graphRes.body);
  assert.strictEqual(graphData.success, true);
  assert(Array.isArray(graphData.graph.nodes), 'Must return graph nodes array');
  assert(Array.isArray(graphData.graph.edges), 'Must return graph edges array');
  assert(graphData.graph.stats.total_nodes >= 1, 'Must have at least 1 node in topology graph');
  console.log(`  ✅ Decentralized Vector Clock Sync & Topology Graph verified! (${graphData.graph.stats.total_nodes} nodes, ${graphData.graph.stats.total_edges} edges)`);

  // TEST 4: Hot Disaster Recovery Snapshot & Restore Engine
  console.log('\n[*] Test 4: Testing Hot Disaster Recovery Snapshot & Restore Engine...');
  const snapRes = await request(`${SERVER_URL}/api/v1/dr/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'test_mega_snapshot_01' })
  });
  assert.strictEqual(snapRes.statusCode, 200, 'Snapshot creation must return 200 OK');
  const snapData = JSON.parse(snapRes.body);
  assert.strictEqual(snapData.success, true);
  assert(snapData.snapshot_id.startsWith('dr_snap_'));
  assert(snapData.checksum && snapData.checksum.length === 64, 'Must return valid SHA256 checksum');

  const listSnapRes = await request(`${SERVER_URL}/api/v1/dr/snapshots`);
  assert.strictEqual(listSnapRes.statusCode, 200);
  const listSnapData = JSON.parse(listSnapRes.body);
  assert.strictEqual(listSnapData.success, true);
  assert(listSnapData.count >= 1);

  const restoreRes = await request(`${SERVER_URL}/api/v1/dr/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot_id: snapData.snapshot_id })
  });
  assert.strictEqual(restoreRes.statusCode, 200);
  const restoreData = JSON.parse(restoreRes.body);
  assert.strictEqual(restoreData.success, true);
  assert.strictEqual(restoreData.snapshot_id, snapData.snapshot_id);
  console.log(`  ✅ Hot DR Snapshot & Restore verified! Snapshot ID: ${snapData.snapshot_id} (SHA256: ${snapData.checksum.slice(0, 16)}...)`);

  // TEST 5: AES-256-GCM Encrypted Secret Vault
  console.log('\n[*] Test 5: Testing Fast Cache & AES-256-GCM Encrypted Secret Vault...');
  const secretKey = 'DATABASE_MASTER_URL';
  const secretVal = 'postgresql://admin:super_secret_token_99@10.77.0.1:5432/space_station';

  const vaultPutRes = await request(`${SERVER_URL}/api/v1/vault/secrets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: secretKey, value: secretVal, tags: ['production', 'database'] })
  });
  assert.strictEqual(vaultPutRes.statusCode, 200);
  const vaultPutData = JSON.parse(vaultPutRes.body);
  assert.strictEqual(vaultPutData.stored, true);

  // Read masked
  const vaultGetMasked = await request(`${SERVER_URL}/api/v1/vault/secrets`);
  assert.strictEqual(vaultGetMasked.statusCode, 200);
  const maskedData = JSON.parse(vaultGetMasked.body);
  const foundMasked = maskedData.secrets.find(s => s.key === secretKey);
  assert.ok(foundMasked);
  assert.strictEqual(foundMasked.value, '********', 'Unprivileged get must mask secret value');

  // Read revealed
  const vaultGetRevealed = await request(`${SERVER_URL}/api/v1/vault/secrets?reveal=true`);
  assert.strictEqual(vaultGetRevealed.statusCode, 200);
  const revealedData = JSON.parse(vaultGetRevealed.body);
  const foundRevealed = revealedData.secrets.find(s => s.key === secretKey);
  assert.ok(foundRevealed);
  assert.strictEqual(foundRevealed.value, secretVal, 'Decrypted secret must match plaintext original');

  // Delete
  const vaultDelRes = await request(`${SERVER_URL}/api/v1/vault/secrets`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: secretKey })
  });
  assert.strictEqual(vaultDelRes.statusCode, 200);
  console.log('  ✅ AES-256-GCM Encrypted Secret Vault verified with zero-leak masking and cryptographic round-trip!');

  // TEST 6: Doctor Service 24-Point Comprehensive Matrix
  console.log('\n[*] Test 6: Testing Doctor Service 24-Point Comprehensive Health Matrix...');
  const DoctorService = require('../services/core/doctor-service');
  const doctor = new DoctorService();
  const diag = await doctor.runFullDiagnostics();
  assert.strictEqual(diag.checks_total, 24, `Must run exactly 24 comprehensive checks, got ${diag.checks_total}`);
  assert.strictEqual(diag.overall_status, 'HEALTHY');
  assert.ok(diag.checks.dns_resolution_latency, 'Must check DNS resolution latency');
  assert.ok(diag.checks.ntp_clock_drift, 'Must check monotonic clock drift');
  assert.ok(diag.checks.tls_handshake_readiness, 'Must check elliptic curves and mTLS readiness');
  assert.ok(diag.checks.cluster_quorum_status, 'Must check cluster quorum status');
  console.log(`  ✅ Doctor Service 24-Point Diagnostics verified! Score: ${diag.health_score}/100, Checks: ${diag.checks_passed}/24 passed`);

  console.log('\n================================================================');
  console.log('🎉 ALL MEGA UPGRADES (TEST 59) VERIFIED AND PASSING 100%!');
  console.log('================================================================\n');
}

if (require.main === module) {
  runMegaUpgradesTests().catch(err => {
    console.error('❌ Mega Upgrades verification failed:', err);
    process.exit(1);
  });
}

module.exports = { runMegaUpgradesTests };
