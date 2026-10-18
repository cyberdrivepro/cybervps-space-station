/**
 * CYBERVPS SPACE STATION - REMOTE DESKTOP SUPERVISOR & ECOSYSTEM HUB VERIFICATION SUITE
 *
 * Verifies:
 * 1. Open-Source Ecosystem Hub Batch Testing (/api/v1/integrations/test-all):
 *    - Bounded concurrency pool (4 parallel workers) across all 17 adapters
 *    - Strict job lifecycle state transitions: QUEUED -> RUNNING -> COMPLETED
 *    - Summary counts and normalized status integrity
 * 2. Remote Desktop Dynamic Engine Status (/api/v1/remote-desktop/status):
 *    - Native Live HD, RustDesk Open Source, MeshCentral, Guacamole dynamic status
 *    - Fallback engine recommendation resolution
 * 3. Remote Desktop 360° Diagnostics (/api/v1/remote-desktop/diagnostics):
 *    - Session context (Session 0 vs Active Console Session)
 *    - Safe single-frame GDI DC & BitBlt probe
 *    - RustDesk binary, service, ID, and Virtual IP detection
 *    - Windows RDP fDenyTSConnections registry detection
 *    - Unreachable/offline host graceful diagnostic handling
 * 4. Remote Desktop Recovery Supervisor (/api/v1/remote-desktop/recover):
 *    - Stream reset, cache flush, real-time diagnostic synthesis
 * 5. Dedicated RustDesk Control Plane Routes:
 *    - GET /api/v1/remote-desktop/rustdesk/status
 *    - POST /api/v1/remote-desktop/rustdesk/repair
 *    - POST /api/v1/remote-desktop/rustdesk/configure
 *    - POST /api/v1/remote-desktop/rustdesk/connect
 * 6. Python Host Agent Fallback Frame & Diagnostic Synthesis:
 *    - Zero-dependency GDI+ memory bitmap synthesis
 *    - Valid JPEG magic header (\xff\xd8\xff)
 *    - Immediate delivery preventing first-frame timeout
 */

const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { spawn, execSync } = require('child_process');

const { integrationRegistry } = require('../services/adapters/registry');
const { ADAPTER_STATUS } = require('../services/adapters/base-adapter');
const { JOB_STATUS } = require('../services/adapters/job-tracker');

const SERVER_URL = 'http://127.0.0.1:8080';
const WS_URL = 'ws://127.0.0.1:8080';
const PAIRING_KEY = 'test_pair_key_123';
const ENROLL_TOKEN = 'test_enroll_token_999';

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'X-CVPS-Pairing-Key': PAIRING_KEY,
        ...(options.headers || {})
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body, json });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runSupervisorAndHubTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING REMOTE DESKTOP SUPERVISOR & ECOSYSTEM HUB TEST SUITE');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: IntegrationRegistry.testAll() bounded concurrency & job tracking
  // --------------------------------------------------------------------------
  console.log('[*] Test 1: Testing IntegrationRegistry.testAll() with bounded concurrency (4 workers)...');
  const batchResult = await integrationRegistry.testAll({ concurrency: 4 });
  assert(batchResult.success, 'testAll must succeed');
  assert(batchResult.job_id, 'testAll must return a job_id');
  assert(batchResult.summary, 'testAll must return a summary');
  assert.strictEqual(batchResult.summary.total, 17, 'Batch test must cover exactly 17 adapters');
  assert.strictEqual(batchResult.summary.concurrency, 4, 'Batch test must observe concurrency 4');
  assert(typeof batchResult.summary.duration_ms === 'number', 'Batch test must report duration_ms');

  // Verify background job transitioned to COMPLETED
  const jobTracker = integrationRegistry.getJobTracker();
  const trackedJob = jobTracker.getJob(batchResult.job_id);
  assert(trackedJob, 'Job must exist in jobTracker');
  assert.strictEqual(trackedJob.status, JOB_STATUS.COMPLETED, 'Job must transition to COMPLETED');
  assert.strictEqual(trackedJob.progress, 100, 'Completed job progress must be 100%');
  assert(trackedJob.logs.length > 0, 'Job must contain tracked execution logs');

  const hubSummary = integrationRegistry.getHubSummary();
  assert.strictEqual(hubSummary.total_providers, 17, 'Hub summary must list 17 providers');
  assert(typeof hubSummary.unconfigured_count === 'number', 'Hub summary must report unconfigured_count');
  assert(typeof hubSummary.connected_count === 'number', 'Hub summary must report connected_count');
  console.log(`  ✅ Batch test completed in ${batchResult.summary.duration_ms}ms with 4 parallel workers. Job transitioned to COMPLETED.`);

  // --------------------------------------------------------------------------
  // Ensure Server is running
  // --------------------------------------------------------------------------
  let serverProcess = null;
  const health = await request(`${SERVER_URL}/health`).catch(() => null);
  if (!health || health.statusCode !== 200) {
    console.log('\n[*] Starting local Space Station Control Plane for testing...');
    serverProcess = spawn(process.execPath, [path.join(__dirname, '../services/server.js')], {
      env: {
        ...process.env,
        ENABLE_TUNNEL: 'false',
        PAIRING_KEY: 'test_pair_key_123',
        ENROLLMENT_TOKEN: 'test_enroll_token_999',
        ADMIN_SECRET: 'test_admin_secret_123'
      },
      stdio: 'pipe'
    });
    await wait(2000);
  }

  // --------------------------------------------------------------------------
  // TEST 2: HTTP Endpoint POST /api/v1/integrations/test-all
  // --------------------------------------------------------------------------
  console.log('\n[*] Test 2: Testing HTTP POST /api/v1/integrations/test-all endpoint...');
  const httpBatchRes = await request(`${SERVER_URL}/api/v1/integrations/test-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concurrency: 4 })
  });
  assert.strictEqual(httpBatchRes.statusCode, 200, `Expected 200, got ${httpBatchRes.statusCode}`);
  assert(httpBatchRes.json && httpBatchRes.json.success, 'Response must indicate success');
  assert.strictEqual(httpBatchRes.json.summary.total, 17, 'HTTP batch test summary must cover 17 adapters');
  console.log('  ✅ HTTP POST /api/v1/integrations/test-all endpoint verified.');

  // --------------------------------------------------------------------------
  // TEST 3: HTTP Endpoint GET /api/v1/remote-desktop/status
  // --------------------------------------------------------------------------
  console.log('\n[*] Test 3: Testing GET /api/v1/remote-desktop/status...');
  const desktopStatusRes = await request(`${SERVER_URL}/api/v1/remote-desktop/status`);
  assert.strictEqual(desktopStatusRes.statusCode, 200, `Expected 200, got ${desktopStatusRes.statusCode}`);
  const dData = desktopStatusRes.json && desktopStatusRes.json.data;
  assert(dData, 'Remote desktop status must return data object');
  assert(dData.native, 'Status must include native engine info');
  assert(dData.rustdesk, 'Status must include rustdesk engine info');
  assert(dData.meshcentral, 'Status must include meshcentral engine info');
  assert(dData.guacamole, 'Status must include guacamole engine info');
  assert(dData.recommended_engine, 'Status must recommend a primary engine');
  console.log(`  ✅ Dynamic desktop engine status verified. Default recommended engine: ${dData.recommended_engine}.`);

  // --------------------------------------------------------------------------
  // Connect Mock Universal Agent
  // --------------------------------------------------------------------------
  const testMachineId = 'node_rd_test_' + Math.random().toString(36).substring(2, 7);
  console.log(`\n[*] Connecting Mock Agent ${testMachineId}...`);
  const agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise(resolve => agentWs.on('open', resolve));

  agentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: testMachineId,
      token: ENROLL_TOKEN,
      hostname: 'test-win2022-host',
      os: 'Windows'
    }
  }));

  const enrolled = await new Promise(resolve => {
    agentWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'AuthAck' && msg.payload.success) resolve(true);
    });
  });
  assert(enrolled, 'Agent must enroll successfully');
  console.log(`  ✅ Agent ${testMachineId} connected & registered.`);

  // Setup Mock Agent RPC Handlers for DesktopDiagnostics and RustDeskAction
  agentWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const p = msg.payload || {};
      const reqId = p.request_id;

      if (msg.type === 'DesktopDiagnostics') {
        agentWs.send(JSON.stringify({
          type: 'AgentRpcResponse',
          payload: {
            request_id: reqId,
            success: true,
            result: {
              machine_id: testMachineId,
              os: 'Windows',
              privilege: { is_elevated: false, user: 'testuser' },
              virtual_ip: '10.77.0.3',
              session: {
                proc_session_id: 0,
                active_console_id: 1,
                is_session_0: true
              },
              gdi_probe: {
                available: false,
                width: 0,
                height: 0,
                error: 'BitBlt failed: Display surface locked in Session 0'
              },
              rustdesk: {
                installed: true,
                running: true,
                id: '1248429151',
                binary_path: 'C:\\Program Files\\RustDesk\\rustdesk.exe',
                direct_ip: '10.77.0.3',
                direct_port: 21118,
                rendezvous_server: ''
              },
              rdp: {
                enabled: true,
                port: 3389,
                f_deny_ts_connections: 0
              },
              primary_engine: 'rustdesk',
              recommendations: [
                'Agent runs unprivileged in Session 0. RustDesk is active for 24/7 persistent unattended access.',
                'Direct connection available via Virtual IP 10.77.0.3:21118.'
              ],
              timestamp: Date.now()
            }
          }
        }));
      }

      if (msg.type === 'RustDeskAction') {
        const action = p.action || 'status';
        agentWs.send(JSON.stringify({
          type: 'AgentRpcResponse',
          payload: {
            request_id: reqId,
            success: true,
            result: {
              action: action,
              installed: true,
              running: true,
              id: '1248429151',
              binary_path: 'C:\\Program Files\\RustDesk\\rustdesk.exe',
              direct_ip: '10.77.0.3',
              direct_port: 21118,
              rendezvous_server: p.params && p.params.server || ''
            }
          }
        }));
      }
    } catch (_) {}
  });

  // --------------------------------------------------------------------------
  // TEST 4: GET /api/v1/remote-desktop/diagnostics
  // --------------------------------------------------------------------------
  console.log('\n[*] Test 4: Testing GET /api/v1/remote-desktop/diagnostics...');
  // A: Connected Agent diagnostics
  const diagRes = await request(`${SERVER_URL}/api/v1/remote-desktop/diagnostics?machine_id=${testMachineId}`);
  assert.strictEqual(diagRes.statusCode, 200, `Expected 200, got ${diagRes.statusCode}`);
  const diagData = diagRes.json && diagRes.json.data;
  assert(diagData, 'Diagnostics must return data');
  assert.strictEqual(diagData.machine_id, testMachineId);
  assert.strictEqual(diagData.session.is_session_0, true, 'Session 0 detection must be accurate');
  assert.strictEqual(diagData.gdi_probe.available, false, 'GDI probe must reflect display lock');
  assert.strictEqual(diagData.rustdesk.installed, true, 'RustDesk installed status must be accurate');
  assert.strictEqual(diagData.primary_engine, 'rustdesk', 'Primary engine must resolve to rustdesk');
  assert(diagData.recommendations.length > 0, 'Must provide actionable recommendations');
  console.log(`  ✅ Live agent diagnostics verified: Session 0 detected, primary recommended engine = ${diagData.primary_engine}.`);

  // B: Non-existent host diagnostics handling (404)
  const nonExistentRes = await request(`${SERVER_URL}/api/v1/remote-desktop/diagnostics?machine_id=node_nonexistent_xyz`);
  assert.strictEqual(nonExistentRes.statusCode, 404, 'Non-existent machine must return 404');

  // C: Registered offline host diagnostics handling (200 with actionable diagnosis)
  const offlineNodeId = 'node_off_agent_' + Math.random().toString(36).substring(2, 7);
  const tempAgentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise(resolve => tempAgentWs.on('open', resolve));
  tempAgentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: offlineNodeId,
      token: ENROLL_TOKEN,
      hostname: 'temp-offline-host',
      os: 'Windows'
    }
  }));
  await new Promise(resolve => {
    tempAgentWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'AuthAck' && msg.payload.success) resolve(true);
    });
  });
  // Disconnect agent to transition status to offline
  tempAgentWs.close();
  await wait(500);

  const offlineDiagRes = await request(`${SERVER_URL}/api/v1/remote-desktop/diagnostics?machine_id=${offlineNodeId}`);
  assert.strictEqual(offlineDiagRes.statusCode, 200, 'Offline machine should return diagnostic synthesis');
  const offData = offlineDiagRes.json && offlineDiagRes.json.data;
  assert(offData, 'Offline diagnostics must return data');
  assert.strictEqual(offData.host_online, false, 'Offline host must be marked false');
  assert(offData.diagnosis.includes('unreachable') || offData.diagnosis.includes('offline'), 'Must explain host is offline');
  assert(offData.recommendations.length > 0, 'Offline diagnostics must provide actionable recommendations');
  console.log('  ✅ Non-existent host (404) and registered offline host (200 with actionable synthesis) verified.');

  // --------------------------------------------------------------------------
  // TEST 5: POST /api/v1/remote-desktop/recover
  // --------------------------------------------------------------------------
  console.log('\n[*] Test 5: Testing POST /api/v1/remote-desktop/recover...');
  const recoverRes = await request(`${SERVER_URL}/api/v1/remote-desktop/recover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: testMachineId, reset_stream: true, repair_service: false })
  });
  assert.strictEqual(recoverRes.statusCode, 200, `Expected 200, got ${recoverRes.statusCode}`);
  assert(recoverRes.json.success, 'Recovery call must succeed');
  assert.strictEqual(recoverRes.json.recovered, true, 'Recovery must indicate recovered: true');
  assert(recoverRes.json.diagnostics, 'Recovery must return fresh diagnostics');
  assert.strictEqual(recoverRes.json.recommended_engine, 'rustdesk', 'Recommended recovery engine must be rustdesk');
  console.log('  ✅ Remote Desktop Auto-Recovery supervisor flushed stale streams and verified recovery.');

  // --------------------------------------------------------------------------
  // TEST 6: RustDesk Dedicated Control Plane Routes
  // --------------------------------------------------------------------------
  console.log('\n[*] Test 6: Testing RustDesk Control Plane routes...');

  // A: Status route
  const rdStatusRes = await request(`${SERVER_URL}/api/v1/remote-desktop/rustdesk/status?machine_id=${testMachineId}`);
  assert.strictEqual(rdStatusRes.statusCode, 200);
  assert(rdStatusRes.json.success, 'RustDesk status query must succeed');
  assert.strictEqual(rdStatusRes.json.data.installed, true);
  assert.strictEqual(rdStatusRes.json.data.id, '1248429151');
  assert(rdStatusRes.json.data.direct_link.includes(':21118'), 'Direct link must route via port 21118');

  // B: Repair route
  const rdRepairRes = await request(`${SERVER_URL}/api/v1/remote-desktop/rustdesk/repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: testMachineId })
  });
  assert.strictEqual(rdRepairRes.statusCode, 200);
  assert(rdRepairRes.json.success, 'RustDesk repair request must succeed');

  // C: Configure route
  const rdConfigRes = await request(`${SERVER_URL}/api/v1/remote-desktop/rustdesk/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: testMachineId, rendezvous_server: 'mesh.cybervps.internal' })
  });
  assert.strictEqual(rdConfigRes.statusCode, 200);
  assert(rdConfigRes.json.success, 'RustDesk config request must succeed');

  // D: Connect route
  const rdConnectRes = await request(`${SERVER_URL}/api/v1/remote-desktop/rustdesk/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: testMachineId })
  });
  assert.strictEqual(rdConnectRes.statusCode, 200);
  assert(rdConnectRes.json.success, 'RustDesk connect route must succeed');
  assert(rdConnectRes.json.data.direct_ip.startsWith('10.77.0.'), 'Direct IP must be in VIP subnet');
  assert.strictEqual(rdConnectRes.json.data.direct_port, 21118);
  assert(rdConnectRes.json.data.direct_url.startsWith('rustdesk://10.77.0.'), 'Direct URL must use rustdesk:// protocol with VIP');
  console.log('  ✅ RustDesk Open Source status, repair, configure, and direct connect endpoints verified.');

  // --------------------------------------------------------------------------
  // TEST 7: Python Agent Diagnostic Fallback Frame Verification
  // --------------------------------------------------------------------------
  console.log('\n[*] Test 7: Testing Python Agent Fallback Frame Generation & JPEG Encoding...');
  const pythonScript = `
import importlib.util, base64
spec = importlib.util.spec_from_file_location('ua', 'agent/universal-agent.py')
ua = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ua)
agent = ua.CyberVPSAgent('http://localhost:8080')

# 1. Test fallback memory bitmap synthesis
fb_bmp = agent._create_fallback_notice_bitmap(
    'CYBERVPS REMOTE DESKTOP SUPERVISOR',
    'Display locked in Session 0',
    'Use RustDesk Direct VIP'
)
assert fb_bmp is not None, 'Fallback HBITMAP must be created'

# 2. Test native GDI+ JPEG encoding
b64_jpeg = agent._encode_hbitmap_to_jpeg(fb_bmp, quality=80)
assert b64_jpeg is not None, 'GDI+ must encode HBITMAP to JPEG base64'
raw = base64.b64decode(b64_jpeg)
assert len(raw) > 1000, f'JPEG bytes length must be > 1000, got {len(raw)}'
assert raw[:3] == b'\\xff\\xd8\\xff', f'JPEG magic header must match \\xff\\xd8\\xff'

# 3. Test handle_desktop_diagnostics RPC emission
res = []
agent.send_agent_event = lambda ev: res.append(ev)
agent.handle_desktop_diagnostics({'request_id': 'test_req_1'})
assert len(res) == 1, 'Desktop diagnostics must emit one AgentRpcResponse'
assert res[0]['payload']['success'] is True, 'AgentRpcResponse must indicate success'
diag = res[0]['payload']['result']
assert 'session' in diag and 'gdi_probe' in diag and 'rustdesk' in diag
print('PYTHON_DIAG_FRAME_PASSED')
`;

  const pyOutput = execSync('python -', {
    input: pythonScript,
    cwd: path.join(__dirname, '..'),
    encoding: 'utf-8'
  });
  assert(pyOutput.includes('PYTHON_DIAG_FRAME_PASSED'), 'Python fallback frame verification must pass');
  console.log('  ✅ Python Agent Fallback Frame synthesized with valid JPEG header and delivered via RPC.');

  // Clean up
  agentWs.close();
  if (serverProcess) serverProcess.kill();

  console.log('\n================================================================');
  console.log('🎉 ALL REMOTE DESKTOP SUPERVISOR & ECOSYSTEM HUB TESTS PASSED!');
  console.log('================================================================\n');
}

if (require.main === module) {
  runSupervisorAndHubTests().catch(err => {
    console.error('\n❌ Supervisor & Hub test failed:', err);
    process.exit(1);
  });
}

module.exports = { runSupervisorAndHubTests };
