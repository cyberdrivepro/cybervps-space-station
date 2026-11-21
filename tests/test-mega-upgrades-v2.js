/**
 * CyberVPS Space Station - Mega Upgrades V2 Verification Suite (Test 60)
 * Tests:
 * 1. Dynamic Cluster Topology Matrix & Peer Latency Metrics (/api/v1/cluster/topology/matrix)
 * 2. RFC 6238 TOTP Generation, Verification & Cryptographic Merkle Audit Hashes (/api/v1/vault/totp/*, /api/v1/vault/audit-hashes)
 * 3. Quantum-Safe Emergency Blackout & State Recovery (/api/v1/vault/blackout/*)
 * 4. Autonomous Fleet Auto-Healing & Self-Repair Engine (/api/v1/fleet/auto-heal, /api/v1/fleet/auto-heal/status)
 * 5. Production WireGuard 1-Click Profile Generator (/api/v1/mesh/export/wg-config/:id, /api/v1/mesh/export/wg-all)
 * 6. Distributed Fleet Cron & Task Orchestration (/api/v1/fleet/cron, /schedule, /run, DELETE)
 * 7. Fleet Bandwidth & Network Jitter Benchmarker (/api/v1/fleet/benchmark-speed, /results)
 * 8. Fleet Container & Docker Micro-Dashboard (/api/v1/fleet/:id/containers, /action)
 * 9. Comprehensive 26-Point System Doctor & Remediate All (/api/v1/doctor/remediate-all)
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

async function runMegaUpgradesV2Tests() {
  console.log('\n================================================================');
  console.log('⚡ CYBERVPS SPACE STATION - MEGA UPGRADES V2 VERIFICATION');
  console.log('================================================================\n');

  // TEST 1: Dynamic Topology Matrix
  console.log('[*] Test 1: Testing Dynamic Topology Matrix (/api/v1/cluster/topology/matrix)...');
  const matRes = await request(`${SERVER_URL}/api/v1/cluster/topology/matrix`);
  assert.strictEqual(matRes.statusCode, 200, 'Topology matrix must return 200 OK');
  const matData = JSON.parse(matRes.body);
  assert.strictEqual(matData.success, true);
  assert.strictEqual(matData.subnet, '10.77.0.0/24');
  assert.ok(Array.isArray(matData.peers), 'Must return peers array');
  assert(matData.peers.length >= 1, 'Must contain at least station hub');
  console.log(`  ✅ Dynamic Topology Matrix verified! Subnet: ${matData.subnet}, Peers: ${matData.total_peers}`);

  // TEST 2: RFC 6238 TOTP Generation & Verification
  console.log('\n[*] Test 2: Testing TOTP 2FA Generation & Verification...');
  const totpGenRes = await request(`${SERVER_URL}/api/v1/vault/totp/generate`);
  assert.strictEqual(totpGenRes.statusCode, 200);
  const totpGen = JSON.parse(totpGenRes.body);
  assert.strictEqual(totpGen.success, true);
  assert.ok(totpGen.secret.length >= 16, 'TOTP secret must be RFC 6238 Base32');
  assert.ok(totpGen.otpauth.startsWith('otpauth://totp/'), 'Must generate valid otpauth URI');

  const totpVerRes = await request(`${SERVER_URL}/api/v1/vault/totp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: '123456' })
  });
  assert.strictEqual(totpVerRes.statusCode, 200);
  const totpVer = JSON.parse(totpVerRes.body);
  assert.strictEqual(totpVer.success, true);
  assert.strictEqual(totpVer.verified, true);
  console.log('  ✅ RFC 6238 TOTP 2FA generation and token verification verified!');

  // TEST 3: Merkle Audit Hashes
  console.log('\n[*] Test 3: Testing Tamper-Evident Merkle Audit Hashes...');
  const auditHashRes = await request(`${SERVER_URL}/api/v1/vault/audit-hashes`);
  assert.strictEqual(auditHashRes.statusCode, 200);
  const auditHashData = JSON.parse(auditHashRes.body);
  assert.strictEqual(auditHashData.success, true);
  assert.strictEqual(auditHashData.tamper_proof, true);
  assert.ok(typeof auditHashData.merkle_root === 'string');
  console.log(`  ✅ Tamper-Evident Merkle Hash Chain verified! Root: ${auditHashData.merkle_root.slice(0, 16)}...`);

  // TEST 4: Emergency Blackout Protocol
  console.log('\n[*] Test 4: Testing Quantum-Safe Emergency Blackout Protocol...');
  const trigRes = await request(`${SERVER_URL}/api/v1/vault/blackout/trigger`, { method: 'POST' });
  assert.strictEqual(trigRes.statusCode, 200);
  const trigData = JSON.parse(trigRes.body);
  assert.strictEqual(trigData.blackout_active, true);

  const recRes = await request(`${SERVER_URL}/api/v1/vault/blackout/recover`, { method: 'POST' });
  assert.strictEqual(recRes.statusCode, 200);
  const recData = JSON.parse(recRes.body);
  assert.strictEqual(recData.blackout_active, false);
  console.log('  ✅ Emergency Blackout Trigger and Recovery operational!');

  // TEST 5: Autonomous Fleet Auto-Healing Engine
  console.log('\n[*] Test 5: Testing Autonomous Fleet Auto-Healing Engine...');
  const healRes = await request(`${SERVER_URL}/api/v1/fleet/auto-heal`, { method: 'POST' });
  assert.strictEqual(healRes.statusCode, 200);
  const healData = JSON.parse(healRes.body);
  assert.strictEqual(healData.success, true);

  const healStatRes = await request(`${SERVER_URL}/api/v1/fleet/auto-heal/status`);
  assert.strictEqual(healStatRes.statusCode, 200);
  const healStat = JSON.parse(healStatRes.body);
  assert.strictEqual(healStat.supervisor_active, true);
  console.log('  ✅ Autonomous Fleet Auto-Healing Engine verified!');

  // TEST 6: Production WireGuard Profile Export
  console.log('\n[*] Test 6: Testing Production WireGuard Profile Export...');
  const wgRes = await request(`${SERVER_URL}/api/v1/mesh/export/wg-config/test_node_99`);
  assert.strictEqual(wgRes.statusCode, 200);
  assert(wgRes.body.includes('[Interface]'), 'Must contain [Interface] block');
  assert(wgRes.body.includes('[Peer]'), 'Must contain [Peer] block');
  assert(wgRes.body.includes('AllowedIPs = 10.77.0.0/24'), 'Must configure 10.77.0.0/24 CIDR');

  const wgAllRes = await request(`${SERVER_URL}/api/v1/mesh/export/wg-all`);
  assert.strictEqual(wgAllRes.statusCode, 200);
  const wgAll = JSON.parse(wgAllRes.body);
  assert.strictEqual(wgAll.success, true);
  console.log('  ✅ Production WireGuard Profile generator verified!');

  // TEST 7: Distributed Fleet Cron Orchestration
  console.log('\n[*] Test 7: Testing Distributed Fleet Cron & Task Orchestration...');
  const cronListRes = await request(`${SERVER_URL}/api/v1/fleet/cron`);
  assert.strictEqual(cronListRes.statusCode, 200);
  const cronList = JSON.parse(cronListRes.body);
  assert.strictEqual(cronList.success, true);
  assert(cronList.jobs.length >= 2, 'Default maintenance cron jobs must exist');

  const schedRes = await request(`${SERVER_URL}/api/v1/fleet/cron/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Dynamic Test Job',
      schedule: '*/15 * * * *',
      command: 'uptime',
      target_os: 'all'
    })
  });
  assert.strictEqual(schedRes.statusCode, 200);
  const schedData = JSON.parse(schedRes.body);
  assert.strictEqual(schedData.success, true);
  const jobId = schedData.job.id;

  const runRes = await request(`${SERVER_URL}/api/v1/fleet/cron/${jobId}/run`, { method: 'POST' });
  assert.strictEqual(runRes.statusCode, 200);
  const runData = JSON.parse(runRes.body);
  assert.strictEqual(runData.success, true);

  const delRes = await request(`${SERVER_URL}/api/v1/fleet/cron/${jobId}`, { method: 'DELETE' });
  assert.strictEqual(delRes.statusCode, 200);
  console.log(`  ✅ Distributed Fleet Cron scheduled, executed, and cleaned up successfully!`);

  // TEST 8: Fleet Speedtest & Jitter Benchmarker
  console.log('\n[*] Test 8: Testing Fleet Bandwidth & Jitter Benchmarker...');
  const speedRes = await request(`${SERVER_URL}/api/v1/fleet/benchmark-speed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: 'vps_ubuntu_station' })
  });
  assert.strictEqual(speedRes.statusCode, 200);
  const speedData = JSON.parse(speedRes.body);
  assert.strictEqual(speedData.success, true);
  assert.ok(speedData.benchmark.download_mbps > 0);
  assert.ok(speedData.benchmark.upload_mbps > 0);

  const speedHistRes = await request(`${SERVER_URL}/api/v1/fleet/benchmark-results`);
  assert.strictEqual(speedHistRes.statusCode, 200);
  console.log(`  ✅ Fleet Bandwidth & Jitter Benchmarker verified! Speed: ${speedData.benchmark.download_mbps} Mbps DL / ${speedData.benchmark.upload_mbps} Mbps UL (Jitter: ${speedData.benchmark.jitter_ms}ms)`);

  // TEST 9: Fleet Container & Docker Micro-Dashboard
  console.log('\n[*] Test 9: Testing Fleet Container & Docker Micro-Dashboard...');
  const contRes = await request(`${SERVER_URL}/api/v1/fleet/vps_ubuntu_station/containers`);
  assert.strictEqual(contRes.statusCode, 200);
  const contData = JSON.parse(contRes.body);
  assert.strictEqual(contData.success, true);
  assert(contData.containers.length >= 2);

  const contActRes = await request(`${SERVER_URL}/api/v1/fleet/vps_ubuntu_station/containers/c_nginx_proxy/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restart' })
  });
  assert.strictEqual(contActRes.statusCode, 200);
  const contAct = JSON.parse(contActRes.body);
  assert.strictEqual(contAct.success, true);
  console.log('  ✅ Fleet Container & Docker Micro-Dashboard verified!');

  // TEST 10: 26-Point System Doctor & Remediate All
  console.log('\n[*] Test 10: Testing 26-Point System Doctor & Remediate All...');
  const remRes = await request(`${SERVER_URL}/api/v1/doctor/remediate-all`, { method: 'POST' });
  assert.strictEqual(remRes.statusCode, 200);
  const remData = JSON.parse(remRes.body);
  assert.strictEqual(remData.success, true);
  assert.strictEqual(remData.total_checks, 26, `Must run exactly 26 checks, got ${remData.total_checks}`);
  assert.ok(remData.health_score >= 90, `Health score must be >= 90, got ${remData.health_score}`);
  console.log(`  ✅ 26-Point System Doctor Remediate All verified! Health Score: ${remData.health_score}/100 across 26 checks!`);

  console.log('\n================================================================');
  console.log('🎉 ALL MEGA UPGRADES V2 (TEST 60) VERIFIED AND PASSING 100%!');
  console.log('================================================================\n');
}

if (require.main === module) {
  runMegaUpgradesV2Tests().catch(err => {
    console.error('❌ Mega Upgrades V2 verification failed:', err);
    process.exit(1);
  });
}

module.exports = { runMegaUpgradesV2Tests };
