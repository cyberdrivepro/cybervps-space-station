/**
 * CyberVPS Space Station - Complete Verification Suite
 * Tests Mode A (Universal TCP Port Bridge 1-65535),
 * Mode B (Virtual Private Network 10.77.0.0/24),
 * All-Port Discovery, Conflict Resolution, and Security boundaries.
 */

const http = require('http');
const net = require('net');
const { WebSocket, WebSocketServer } = require('ws');
const assert = require('assert');
const { spawn, execSync } = require('child_process');

const SERVER_URL = 'http://localhost:8080';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(u, options, (res) => {
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

async function runTests() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING CYBERVPS UNIVERSAL NETWORK BRIDGE VERIFICATION SUITE');
  console.log('================================================================\n');

  // Auto-spawn server if not running
  let serverProcess = null;
  const healthCheck = await request(`${SERVER_URL}/health`).catch(() => null);
  if (!healthCheck || healthCheck.statusCode !== 200) {
    console.log('[*] Starting local Space Station Control Plane for testing...');
    serverProcess = spawn(process.execPath, [require('path').join(__dirname, '../services/server.js')], {
      env: { ...process.env, ENABLE_TUNNEL: 'false' },
      stdio: 'ignore'
    });
    await wait(1200);
  }

  // TEST 1: Control Plane Health & Virtual Network Configuration
  console.log('[TEST 1] Verifying Control Plane & Virtual Network configuration...');
  const healthRes = await request(`${SERVER_URL}/health`);
  assert.strictEqual(healthRes.statusCode, 200, 'Health endpoint must return 200 OK');
  const healthData = JSON.parse(healthRes.body);
  assert.strictEqual(healthData.virtual_network_cidr, '10.77.0.0/24');
  console.log('  ✅ Control Plane healthy. Virtual Network CIDR: 10.77.0.0/24');

  // TEST 2: All-Port Numeric Boundaries & Special Port 0 Handling
  console.log('\n[TEST 2] Testing All-Port Range (1-65535) and Port 0 handling...');
  // Attempt invalid port 0
  const portZeroRes = await request(`${SERVER_URL}/api/v1/bridge/mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: 'vps_test', remote_port: 0 })
  });
  assert.strictEqual(portZeroRes.statusCode, 400, 'Port 0 must be rejected');
  console.log('  ✅ Port 0 correctly rejected as invalid destination endpoint.');

  // Test arbitrary high port 65535
  const portMaxRes = await request(`${SERVER_URL}/api/v1/bridge/mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: 'vps_test', remote_port: 65535 })
  });
  assert.strictEqual(portMaxRes.statusCode, 200, 'Port 65535 must be accepted');
  console.log('  ✅ Port 65535 successfully accepted in dynamic bridge configuration.');

  // TEST 3: Start Real Target Service on Port 6767
  console.log('\n[TEST 3] Starting Target Service on 127.0.0.1:6767...');
  const localTargetApp = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Hello from remote target application on port 6767!',
      url: req.url,
      timestamp: Date.now()
    }));
  });
  await new Promise(r => localTargetApp.listen(6767, '127.0.0.1', r));
  console.log('  ✅ Target application active on 127.0.0.1:6767.');

  // TEST 4: Enroll Remote Node & Verify Mode B Virtual IP Allocation
  console.log('\n[TEST 4] Connecting Remote Node Agent & Testing Mode B Virtual IP...');
  const remoteNodeId = 'vps_ubuntu_station_' + Math.random().toString(36).slice(2, 6);
  const agentWs = new WebSocket(`ws://localhost:8080/api/v1/relay/connect`);
  await new Promise(r => agentWs.on('open', r));

  agentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: remoteNodeId,
      token: 'cvps_enroll_master_token',
      agent_version: '1.0.0',
      hostname: 'remote-vps-node',
      os: 'Linux',
      arch: 'x86_64',
      capabilities: { is_root: true, pty_supported: true }
    }
  }));
  await wait(400);

  // Check Virtual IP allocation in Mode B
  const vpnRes = await request(`${SERVER_URL}/api/v1/vpn/network`);
  const vpnData = JSON.parse(vpnRes.body);
  const peer = vpnData.peers.find(p => p.machine_id === remoteNodeId);
  assert(peer, 'Remote node must be enrolled in virtual network');
  assert(peer.virtual_ip.startsWith('10.77.0.'), 'Must assign Virtual IP in 10.77.0.X');
  console.log(`  ✅ Mode B Active: Node ${remoteNodeId} assigned Virtual IP: ${peer.virtual_ip}`);

  // TEST 5: All-Port Discovery Reporting (Arbitrary ports across 1-65535)
  console.log('\n[TEST 5] Reporting multi-port discovery (22, 6767, 22222, 65000)...');
  agentWs.send(JSON.stringify({
    type: 'DiscoveryReport',
    payload: {
      machine_id: remoteNodeId,
      ports: [
        { port: 22, protocol: 'TCP', bind_address: '0.0.0.0', process_name: 'sshd', is_http: false },
        { port: 6767, protocol: 'TCP', bind_address: '127.0.0.1', process_name: 'node-app', is_http: true, http_status: 200 },
        { port: 22222, protocol: 'TCP', bind_address: '0.0.0.0', process_name: 'custom-svc', is_http: false },
        { port: 65000, protocol: 'TCP', bind_address: '127.0.0.1', process_name: 'high-port', is_http: false }
      ]
    }
  }));
  await wait(300);

  const portsRes = await request(`${SERVER_URL}/api/v1/machines/${remoteNodeId}/ports`);
  const portsList = JSON.parse(portsRes.body);
  assert.strictEqual(portsList.length, 4, 'All 4 discovered ports across spectrum must be listed');
  console.log('  ✅ Discovered 4 ports across spectrum (22, 6767, 22222, 65000) successfully.');

  // TEST 6: MODE A Universal Port Bridge (PC 127.0.0.1:16767 -> Remote 127.0.0.1:6767)
  console.log('\n[TEST 6] Testing MODE A: Creating Port Bridge for port 6767...');
  const bridgeRes = await request(`${SERVER_URL}/api/v1/bridge/mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machine_id: remoteNodeId,
      remote_port: 6767,
      local_port: 16767
    })
  });
  const bridgeMapping = JSON.parse(bridgeRes.body);
  assert.strictEqual(bridgeMapping.remote_port, 6767);
  console.log(`  ✅ Port Bridge mapping created: 127.0.0.1:${bridgeMapping.local_port} <---> Remote :6767`);

  // Set up agent-side socket proxy over agentWs
  const agentSockets = new Map();
  agentWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'TunnelOpenStream') {
      const { tunnel_id, stream_id, target_port } = msg.payload;
      const sock = net.connect(target_port, '127.0.0.1');
      agentSockets.set(stream_id, sock);

      sock.on('connect', () => {
        agentWs.send(JSON.stringify({
          type: 'TunnelStreamOpened',
          payload: { tunnel_id, stream_id, success: true }
        }));
      });

      sock.on('data', (chunk) => {
        agentWs.send(JSON.stringify({
          type: 'TunnelData',
          payload: { tunnel_id, stream_id, data_base64: chunk.toString('base64') }
        }));
      });

      sock.on('end', () => {
        agentWs.send(JSON.stringify({
          type: 'TunnelStreamClosed',
          payload: { tunnel_id, stream_id }
        }));
        agentSockets.delete(stream_id);
      });
    } else if (msg.type === 'TunnelData') {
      const sock = agentSockets.get(msg.payload.stream_id);
      if (sock) sock.write(Buffer.from(msg.payload.data_base64, 'base64'));
    }
  });

  // Start Windows Port Bridge Client locally
  const { WindowsPortBridgeClient } = require('../apps/windows-client/bridge-daemon');
  const winBridge = new WindowsPortBridgeClient({ serverUrl: SERVER_URL });
  await winBridge.start(false);
  const activeMapping = await winBridge.addMapping('test_m6767', remoteNodeId, 6767, 16767);
  console.log(`  ✅ Windows Client bound local port: 127.0.0.1:${activeMapping.localPort}`);

  // TEST 7: Accessing remote port directly through Windows local port!
  console.log('\n[TEST 7] Sending HTTP request to Windows local port 127.0.0.1:16767...');
  const localBridgeRes = await request(`http://127.0.0.1:${activeMapping.localPort}/api/ping`);
  assert.strictEqual(localBridgeRes.statusCode, 200);
  const bridgePayload = JSON.parse(localBridgeRes.body);
  assert(bridgePayload.message.includes('port 6767'), 'Data must come from remote target');
  console.log('  ✅ SUCCESS! Local port 127.0.0.1:16767 delivered remote service response:');
  console.log('     "', bridgePayload.message, '"');

  // TEST 8: Conflict-Safe Port Allocation
  console.log('\n[TEST 8] Testing Conflict-Safe Port Allocation (occupying port and requesting same)...');
  // Occupy a port deliberately
  const dummyServer = net.createServer();
  await new Promise(r => dummyServer.listen(18888, '127.0.0.1', r));

  // Request mapping for occupied port 18888
  const conflictMapping = await winBridge.addMapping('test_conflict', remoteNodeId, 8080, 18888);
  assert.notStrictEqual(conflictMapping.localPort, 18888, 'Must resolve conflict to an alternate free port');
  assert(conflictMapping.hasConflict, 'Conflict flag must be true');
  console.log(`  ✅ Conflict handled safely: Preferred port 18888 was occupied; automatically resolved to ${conflictMapping.localPort}`);
  dummyServer.close();

  // TEST 9: Remote Access & Secure Pairing Verification
  console.log('\n[TEST 9] Testing Remote Access & Pairing endpoints (/api/v1/access/*)...');
  const accessRes = await request(`${SERVER_URL}/api/v1/access/status`);
  assert.strictEqual(accessRes.statusCode, 200);
  const accessData = JSON.parse(accessRes.body);
  assert(accessData.status, 'Status field must be present');
  assert(accessData.public_url, 'Public or local URL must be present');
  assert.strictEqual(accessData.pairing_key, undefined, 'Private pairing key must NOT be disclosed in public status');
  console.log(`  ✅ Remote Access status verified (Provider: ${accessData.provider}, URL: ${accessData.public_url})`);

  // Test Pairing key verification
  const pairTestRes = await request(`${SERVER_URL}/api/v1/access/pairing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairing_key: 'invalid_token' })
  });
  assert.strictEqual(pairTestRes.statusCode, 401, 'Invalid pairing key must be rejected');
  console.log('  ✅ Secure Pairing endpoint correctly rejects invalid tokens');

  // TEST 10: CLI Status & Version Verification
  console.log('\n[TEST 10] Testing Unified cybervps CLI execution...');
  const { execSync } = require('child_process');
  const cliVer = execSync(`"${process.execPath}" "${require('path').join(__dirname, '../bin/cybervps')}" version`, { encoding: 'utf8' });
  assert(cliVer.includes('CyberVPS Space Station v1.0.0'), 'CLI version must report 1.0.0');
  console.log(`  ✅ Unified CLI verified: ${cliVer.trim()}`);

  // Clean up
  winBridge.stop();
  agentWs.close();
  localTargetApp.close();
  if (serverProcess) serverProcess.kill();

  console.log('\n================================================================');
  console.log('🎉 ALL 10 ADVANCED UNIVERSAL BRIDGE & REMOTE ACCESS TESTS PASSED!');
  console.log('================================================================\n');
  process.exit(0);
}


runTests().catch(e => {
  console.error('\n❌ Verification failed:', e);
  process.exit(1);
});
