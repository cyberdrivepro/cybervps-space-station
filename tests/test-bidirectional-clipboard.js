/**
 * CYBERVPS SPACE STATION - BIDIRECTIONAL CLIPBOARD SYNC TEST SUITE
 * Tests REST and WebSocket clipboard synchronization pathways
 */

const http = require('http');
const WebSocket = require('ws');
const assert = require('assert');

process.env.PORT = '9972';
process.env.ENROLLMENT_TOKEN = 'test_clip_token_123';
process.env.NODE_ENV = 'test';

const { server, db } = require('../services/server');

const TEST_PORT = 9972;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const WS_URL = `ws://127.0.0.1:${TEST_PORT}`;

function httpRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING BIDIRECTIONAL CLIPBOARD SYNC TEST SUITE');
  console.log('================================================================\n');

  await new Promise(resolve => setTimeout(resolve, 500));

  const machineId = 'node_clip_test_' + Math.random().toString(36).slice(2, 7);
  console.log(`[*] Connecting Mock Agent [${machineId}]...`);

  const agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise(resolve => agentWs.on('open', resolve));

  let mockClipboard = 'Initial remote host clipboard buffer (Unicode 🚀)';

  // Send Auth handshake
  agentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: machineId,
      token: 'test_clip_token_123',
      hostname: 'test-clip-host',
      os: 'Windows',
      capabilities: { rdp: true, clipboard: true }
    }
  }));

  agentWs.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'RemoteDesktopClipboard') {
        const payload = msg.payload || {};
        if (payload.action === 'get') {
          agentWs.send(JSON.stringify({
            type: 'RemoteDesktopClipboard',
            payload: {
              correlation_id: payload.correlation_id,
              request_id: payload.request_id,
              action: 'get',
              text: mockClipboard,
              success: true
            }
          }));
        } else if (payload.action === 'set') {
          mockClipboard = payload.text || '';
          agentWs.send(JSON.stringify({
            type: 'RemoteDesktopClipboard',
            payload: {
              correlation_id: payload.correlation_id,
              request_id: payload.request_id,
              action: 'set',
              text: mockClipboard,
              success: true
            }
          }));
        }
      }
    } catch (_) {}
  });

  // Give agent registration 200ms to settle in db
  await new Promise(r => setTimeout(r, 200));
  console.log('  ✅ Mock agent connected and initialized.\n');

  // Test 1: GET /api/v1/machines/:id/clipboard
  console.log('[*] Test 1: GET /api/v1/machines/:id/clipboard...');
  const getRes = await httpRequest('GET', `/api/v1/machines/${machineId}/clipboard`);
  assert.strictEqual(getRes.status, 200, 'Expected 200 OK');
  assert.strictEqual(getRes.body.success, true);
  assert.strictEqual(getRes.body.text, mockClipboard);
  console.log(`  ✅ Successfully read remote clipboard via GET endpoint: "${getRes.body.text}"`);

  // Test 2: POST /api/v1/machines/:id/clipboard
  console.log('\n[*] Test 2: POST /api/v1/machines/:id/clipboard...');
  const newText = 'Synchronized text buffer from CyberVPS control plane (UTF-16 ✨)';
  const postRes = await httpRequest('POST', `/api/v1/machines/${machineId}/clipboard`, {
    action: 'set',
    text: newText
  });
  assert.strictEqual(postRes.status, 200, 'Expected 200 OK');
  assert.strictEqual(postRes.body.success, true);
  assert.strictEqual(mockClipboard, newText, 'Mock agent clipboard should have been updated');
  console.log(`  ✅ Successfully set remote clipboard via POST endpoint: "${mockClipboard}"`);

  // Test 3: GET /api/v1/remote-desktop/clipboard?machine_id=...
  console.log('\n[*] Test 3: GET /api/v1/remote-desktop/clipboard?machine_id=...');
  const getQueryRes = await httpRequest('GET', `/api/v1/remote-desktop/clipboard?machine_id=${machineId}`);
  assert.strictEqual(getQueryRes.status, 200, 'Expected 200 OK');
  assert.strictEqual(getQueryRes.body.text, newText);
  console.log(`  ✅ Successfully read clipboard via query parameter endpoint: "${getQueryRes.body.text}"`);

  // Test 4: 404 for non-existent machine
  console.log('\n[*] Test 4: 404 on non-existent machine...');
  const notFoundRes = await httpRequest('GET', '/api/v1/machines/non_existent_node_999/clipboard');
  assert.strictEqual(notFoundRes.status, 404, 'Expected 404 for unknown machine');
  console.log('  ✅ Non-existent machine correctly returned 404 Not Found.');

  // Test 5: 503 for offline machine
  console.log('\n[*] Test 5: 503 for offline machine...');
  agentWs.close();
  db.connectedAgents.delete(machineId);
  const m = db.machines.get(machineId);
  m.status = 'offline';
  m.last_seen = new Date(Date.now() - 120000).toISOString();
  const offlineRes = await httpRequest('GET', `/api/v1/machines/${machineId}/clipboard`);
  assert.strictEqual(offlineRes.status, 503, 'Expected 503 for offline machine');
  console.log('  ✅ Offline machine correctly returned 503 Service Unavailable.');

  agentWs.close();
  server.close();

  console.log('\n================================================================');
  console.log('🎉 ALL BIDIRECTIONAL CLIPBOARD TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
