/**
 * CYBERVPS SPACE STATION - CORE DOMAIN SERVICES INTEGRATION TEST
 * Tests FleetManager, FileManager, DoctorService, AuditService, AppManager, TunnelService, MeshManager
 */

const assert = require('assert');
const { CoreServices } = require('../services/core/index');
const { StorageManager } = require('../services/storage/index');

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING CYBERVPS CORE DOMAIN SERVICES INTEGRATION TESTS');
  console.log('================================================================');

  const path = require('path');
  const storage = await StorageManager.create({ dataDir: path.join(__dirname, 'tmp-domain-test') });
  const core = new CoreServices({ storage, enableConsole: false });
  await core.initialize();

  // TEST 1: FleetManager Registration & VIP Subnet Allocation
  console.log('\n[TEST 1] FleetManager Registration & Subnet Allocation...');
  const testId = Date.now().toString(36);
  const winMachineId = `test_core_win_${testId}`;
  const linuxMachineId = `test_core_linux_${testId}`;

  const winMachine = await core.fleetManager.registerMachine({
    machine_id: winMachineId,
    name: 'Windows Production Node',
    platform: 'Windows AMD64',
    ip: '192.168.1.10'
  });
  assert(winMachine.virtual_ip.startsWith('10.77.0.'), 'Virtual IP must be in 10.77.0.0/24 subnet');
  assert.strictEqual(winMachine.status.toLowerCase(), 'online');
  assert(winMachine.os.includes('Windows'), 'OS must be detected as Windows');

  const linuxMachine = await core.fleetManager.registerMachine({
    machine_id: linuxMachineId,
    name: 'Ubuntu Cloud Node',
    platform: 'Linux x86_64',
    ip: '10.0.0.5'
  });
  assert(linuxMachine.virtual_ip.startsWith('10.77.0.'));
  assert.notStrictEqual(winMachine.virtual_ip, linuxMachine.virtual_ip, 'VIPs must be unique');
  console.log(`  ✅ FleetManager registered nodes: Win=${winMachine.virtual_ip}, Linux=${linuxMachine.virtual_ip}`);

  // TEST 2: FleetManager Revocation
  console.log('\n[TEST 2] FleetManager Node Revocation...');
  await core.fleetManager.revokeMachine(winMachineId, 'Admin test revocation');
  const winFetched = await core.fleetManager.getMachine(winMachineId);
  assert.strictEqual(winFetched.status.toLowerCase(), 'revoked');
  assert.strictEqual(core.fleetManager.isRevoked(winMachineId), true);
  console.log('  ✅ FleetManager revocation verified: Revoked node status confirmed');

  // TEST 3: FileManager Path Traversal Guard
  console.log('\n[TEST 3] FileManager Path Traversal Defense...');
  const maliciousPaths = [
    '../../../../etc/passwd',
    '..\\..\\Windows\\System32\\config\\SAM',
    '/etc/shadow\0.txt',
    'C:/test/../../secret.key'
  ];

  for (const badPath of maliciousPaths) {
    let threw = false;
    try {
      core.fileManager.sanitizePath(badPath, '/safe/root');
    } catch (e) {
      threw = true;
    }
    assert(threw, `Path traversal attack should be blocked: ${badPath}`);
  }
  console.log('  ✅ FileManager path traversal defense verified: All attack vectors blocked');

  // TEST 4: AuditService Secret Redaction & CSV Export
  console.log('\n[TEST 4] AuditService Redaction & Query Engine...');
  const sensitiveMsg = 'User authorized with pairing_key=cybervps_pair_super_secret_123 and token=cvps_enroll_master_token';
  const logged = await core.auditService.info('auth_test', sensitiveMsg, {
    machine_id: linuxMachineId,
    secret: 'super_secret_password'
  });

  assert(!logged.message.includes('cybervps_pair_super_secret_123'), 'Pairing key must be redacted');
  assert(!logged.message.includes('cvps_enroll_master_token'), 'Token must be redacted');
  assert.strictEqual(logged.metadata.secret, '[REDACTED]', 'Metadata secret must be redacted');

  const csv = core.auditService.exportCSV();
  assert(csv.includes('Timestamp,Level,Action'), 'CSV must contain standard headers');
  console.log('  ✅ AuditService verified: Strict credential redaction & CSV export working');

  // TEST 5: AppManager Curated Catalog & ConPTY Streaming
  console.log('\n[TEST 5] AppManager Curated Catalog & Window Streaming...');
  const appList = await core.appManager.listApplications(linuxMachineId);
  assert(appList.applications.length > 5, 'Curated applications must be populated');

  const streamSession = await core.appManager.startAppStream(linuxMachineId, 1042, { quality: 85 });
  assert(streamSession.stream_id.startsWith('app_stream_'));
  assert.strictEqual(streamSession.status, 'STREAMING');

  const stopResult = await core.appManager.stopAppStream(streamSession.stream_id);
  assert.strictEqual(stopResult.status, 'STOPPED');
  console.log('  ✅ AppManager verified: App catalog & ConPTY stream lifecycle operational');

  // TEST 6: TunnelService Creation & Health Probing
  console.log('\n[TEST 6] TunnelService Ingress Management...');
  const tunnel = await core.tunnelService.createTunnel({
    name: 'test-gateway-http',
    provider: 'cloudflare',
    target_port: 8080
  });
  assert(tunnel.public_url.includes('trycloudflare.com'));
  const probe = await core.tunnelService.probeTunnel(tunnel.id);
  assert.strictEqual(probe.status, 'ONLINE');
  console.log(`  ✅ TunnelService verified: Ingress tunnel created and probed (${probe.latency_ms}ms)`);

  // TEST 7: MeshManager Topology & WireGuard Config
  console.log('\n[TEST 7] MeshManager WireGuard Configuration Generation...');
  const topology = await core.meshManager.getMeshTopology();
  assert.strictEqual(topology.network, '10.77.0.0/24');
  assert(topology.peers.length >= 2, 'Peers must match registered fleet');

  const wgConfig = await core.meshManager.generateClientConfig(linuxMachineId);
  assert(wgConfig.config.includes('[Interface]'));
  assert(wgConfig.config.includes('[Peer]'));
  assert(wgConfig.config.includes('AllowedIPs = 10.77.0.0/24'));
  console.log('  ✅ MeshManager verified: WireGuard mesh topology & wg0.conf generated');

  // TEST 8: DoctorService 16-Point Deep Diagnostics
  console.log('\n[TEST 8] DoctorService 16-Point Diagnostic Matrix...');
  const diagnosis = await core.doctorService.runFullDiagnostics();
  assert.strictEqual(diagnosis.checks_total, 16);
  assert(diagnosis.checks_passed >= 14, `Expected at least 14 passed checks, got ${diagnosis.checks_passed}`);
  assert(diagnosis.health_score >= 80, `Expected score >= 80, got ${diagnosis.health_score}`);
  console.log(`  ✅ DoctorService verified: ${diagnosis.checks_passed}/16 checks passed, Health Score=${diagnosis.health_score}/100`);

  const remediation = await core.doctorService.runAutoRemediation('bridge_subsystem');
  assert.strictEqual(remediation.action, 'bridge_subsystem');
  console.log('  ✅ DoctorService auto-remediation verified');

  console.log('\n================================================================');
  console.log('🎉 ALL 8 CORE DOMAIN SERVICES INTEGRATION TESTS PASSED!');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
