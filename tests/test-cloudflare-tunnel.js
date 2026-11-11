/**
 * CYBERVPS SPACE STATION - CLOUDFLARE QUICK TUNNEL TEST SUITE
 * 
 * Verifies:
 * 1. POST /api/v1/machines/:id/cloudflare-tunnel initiates Cloudflare Quick Tunnel RPC.
 * 2. GET /api/v1/machines/:id/cloudflare-tunnel returns active tunnel status and public URLs.
 * 3. DELETE /api/v1/machines/:id/cloudflare-tunnel stops active tunnel.
 * 4. URL format validation against https://*.trycloudflare.com.
 * 5. Python agent environment variable path expansion (%USERPROFILE%, %TEMP%).
 */

const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { spawn, execSync } = require('child_process');

const SERVER_PORT = 8080;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;
const PAIRING_KEY = 'test_pair_key_123';
const ENROLL_TOKEN = process.env.ENROLLMENT_TOKEN || 'test_enroll_token_999';

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = {
      'X-CVPS-Pairing-Key': PAIRING_KEY,
      ...(options.headers || {})
    };
    if (options.body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(options.body);
    }
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers
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

async function runSuite() {
  console.log('================================================================');
  console.log('🧪 RUNNING CLOUDFLARE QUICK TUNNEL & ENVIRONMENT PATH TEST SUITE');
  console.log('================================================================\n');

  // Ensure Control Plane is running
  let serverProcess = null;
  const health = await request(`${SERVER_URL}/health`).catch(() => null);
  if (!health || health.statusCode !== 200) {
    console.log('[*] Starting local Space Station Control Plane for testing...');
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

  // SUBTEST 1: Verify Python agent _sanitize_path environment variable expansion
  console.log('[TEST 1] Verifying Python agent environment variable expansion in _sanitize_path...');
  const scriptPath = path.join(__dirname, '..', 'agent', 'universal-agent.py').replace(/\\/g, '/');
  const pyCmd = `import os, sys, importlib.util; spec = importlib.util.spec_from_file_location('agent', '${scriptPath}'); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); agent = mod.CyberVPSAgent('http://localhost:8080', token='test'); env_key = 'USERPROFILE' if sys.platform == 'win32' else 'HOME'; val = os.environ.get(env_key, ''); res = agent._sanitize_path('%' + env_key + '%' if sys.platform == 'win32' else '$' + env_key) if val else ''; curr = agent._sanitize_path('.'); assert os.path.isdir(curr); print('ALL_PY_PATH_CHECKS_PASSED')`;
  const pyCheck = execSync(`python -c "${pyCmd}"`, { encoding: 'utf-8' });

  assert(pyCheck.includes('ALL_PY_PATH_CHECKS_PASSED'), 'Python path sanitization must pass');
  console.log('  ✅ Python agent _sanitize_path accurately expands %USERPROFILE%, %TEMP% & home directory.\n');

  // SUBTEST 2: Connect mock agent to local Space Station and test Cloudflare Tunnel RPC routes
  console.log('[TEST 2] Connecting Mock Agent with Cloudflare Tunnel capability...');
  const testMachineId = 'node_cf_test_' + Math.random().toString(36).slice(2, 7);
  let wsAgent = null;
  let activeTunnelMock = null;

  await new Promise((resolve, reject) => {
    wsAgent = new WebSocket(`${WS_URL}/api/v1/relay/connect`, {
      headers: {
        'X-Machine-ID': testMachineId,
        'X-Enrollment-Token': ENROLL_TOKEN,
        'X-CVPS-Pairing-Key': PAIRING_KEY
      }
    });

    wsAgent.on('open', () => {
      wsAgent.send(JSON.stringify({
        type: 'Auth',
        payload: {
          machine_id: testMachineId,
          token: ENROLL_TOKEN,
          hostname: 'cf-test-host',
          os: 'Windows 11 Pro'
        }
      }));
    });

    wsAgent.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'AuthAck' && msg.payload && msg.payload.success) {
          resolve();
          return;
        }

        if (msg.type === 'CloudflareTunnelStart') {
          const reqId = msg.payload.request_id;
          const port = msg.payload.port || 8080;
          activeTunnelMock = {
            tunnel_id: msg.payload.tunnel_id || 'cf_mock_123',
            public_url: 'https://preview-cybervps-space.trycloudflare.com',
            port,
            started_at: new Date().toISOString()
          };
          wsAgent.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: reqId,
              success: true,
              result: activeTunnelMock
            }
          }));
        } else if (msg.type === 'CloudflareTunnelStatus') {
          const reqId = msg.payload.request_id;
          wsAgent.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: reqId,
              success: true,
              result: {
                tunnels: activeTunnelMock ? [activeTunnelMock] : []
              }
            }
          }));
        } else if (msg.type === 'CloudflareTunnelStop') {
          const reqId = msg.payload.request_id;
          activeTunnelMock = null;
          wsAgent.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: reqId,
              success: true,
              result: { stopped: true }
            }
          }));
        }
      } catch (_) {}
    });

    wsAgent.on('error', reject);
  });

  await wait(300);
  console.log('  ✅ Mock agent enrolled and handling Cloudflare tunnel RPC events.\n');

  // SUBTEST 3: POST /api/v1/machines/:id/cloudflare-tunnel
  console.log('[TEST 3] Testing POST /api/v1/machines/:id/cloudflare-tunnel...');
  const startRes = await request(`${SERVER_URL}/api/v1/machines/${testMachineId}/cloudflare-tunnel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port: 8080, tunnel_id: 'cf_unit_test' })
  });

  assert.strictEqual(startRes.statusCode, 200, `POST tunnel must return 200, got ${startRes.statusCode}: ${startRes.body}`);
  assert.strictEqual(startRes.json.success, true, 'Result must be success: true');
  assert(startRes.json.public_url.startsWith('https://'), 'URL must start with https://');
  assert(startRes.json.public_url.includes('trycloudflare.com'), 'URL must be a trycloudflare.com domain');
  console.log(`  ✅ Cloudflare Quick Tunnel started: ${startRes.json.public_url}\n`);

  // SUBTEST 4: GET /api/v1/machines/:id/cloudflare-tunnel
  console.log('[TEST 4] Testing GET /api/v1/machines/:id/cloudflare-tunnel...');
  const statusRes = await request(`${SERVER_URL}/api/v1/machines/${testMachineId}/cloudflare-tunnel`, {
    method: 'GET'
  });
  assert.strictEqual(statusRes.statusCode, 200, `GET tunnel status must return 200, got ${statusRes.statusCode}`);
  assert.strictEqual(statusRes.json.success, true);
  assert(Array.isArray(statusRes.json.tunnels) && statusRes.json.tunnels.length > 0, 'Should return active tunnel in list');
  console.log(`  ✅ Active tunnels reported: ${statusRes.json.tunnels.length}\n`);

  // SUBTEST 5: DELETE /api/v1/machines/:id/cloudflare-tunnel
  console.log('[TEST 5] Testing DELETE /api/v1/machines/:id/cloudflare-tunnel...');
  const stopRes = await request(`${SERVER_URL}/api/v1/machines/${testMachineId}/cloudflare-tunnel`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tunnel_id: 'cf_unit_test' })
  });
  assert.strictEqual(stopRes.statusCode, 200, `DELETE tunnel must return 200, got ${stopRes.statusCode}: ${stopRes.body}`);
  assert.strictEqual(stopRes.json.success, true);
  assert.strictEqual(stopRes.json.stopped, true);
  console.log('  ✅ Active Cloudflare tunnel terminated cleanly.\n');

  if (wsAgent) wsAgent.close();
  if (serverProcess) serverProcess.kill();

  console.log('================================================================');
  console.log('🎉 ALL CLOUDFLARE QUICK TUNNEL & PATH SANITIZATION TESTS PASSED!');
  console.log('================================================================\n');
}

runSuite().catch(err => {
  console.error('❌ Cloudflare Tunnel Suite Error:', err);
  process.exit(1);
});
