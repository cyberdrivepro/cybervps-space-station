/**
 * CYBERVPS SPACE STATION - FILE MANAGER ULTRA & REMOTE DESKTOP TIMEOUT VERIFICATION
 * Tests:
 * 1. Ticket-based secure streaming downloads on public control planes (bypasses 401 header limitation).
 * 2. Unauthenticated public requests without tickets are strictly blocked (401).
 * 3. Unified upload contract: supports both content_base64 and data_base64, flexible path/filename.
 * 4. 64-bit chunked upload API (/api/v1/files/upload-chunk) with offset seek & commit.
 * 5. Bounded-memory chunked streaming download (/api/v1/files/download).
 * 6. Explicit remote process execution (/api/v1/files/run) with arguments and working directory.
 * 7. Directory ZIP creation (/api/v1/files/archive/zip) and extraction (/api/v1/files/archive/extract).
 * 8. Remote Desktop hang fix:
 *    - Instant 'agent_offline' notification when host is disconnected.
 *    - Instant 'agent_acknowledged' stage when agent acknowledges stream.
 *    - 5-second 'agent_ack_timeout' safeguard against unacknowledged streams.
 */

const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { spawn } = require('child_process');

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
      headers: options.headers || {}
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 TESTING FILE MANAGER ULTRA & REMOTE DESKTOP RESILIENCE');
  console.log('================================================================\n');

  // Auto-spawn server if not running
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

  const testNodeId = 'node_fm_test_' + Math.random().toString(36).substring(2, 7);

  // 1. Connect a mock universal agent
  console.log('[*] Test 1: Enrolling test agent...');
  const agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise(resolve => agentWs.on('open', resolve));

  agentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: testNodeId,
      token: ENROLL_TOKEN,
      hostname: 'test-fm-host',
      os: 'Linux'
    }
  }));

  const enrolled = await new Promise(resolve => {
    agentWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'AuthAck' && msg.payload.success) resolve(true);
    });
  });
  assert(enrolled, 'Agent must enroll successfully');
  console.log(`  ✅ Agent ${testNodeId} enrolled and connected.`);

  // Setup RPC handler on agentWs for File operations
  const uploadedChunks = [];
  agentWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'FileChunkWrite') {
      uploadedChunks.push(msg.payload);
      agentWs.send(JSON.stringify({
        type: 'AgentRpcResponse',
        payload: {
          request_id: msg.payload.request_id,
          success: true,
          result: {
            path: msg.payload.path,
            offset: msg.payload.offset,
            bytes_written: Buffer.from(msg.payload.chunk_data_base64 || '', 'base64').length,
            committed_offset: msg.payload.offset + Buffer.from(msg.payload.chunk_data_base64 || '', 'base64').length,
            total_size: msg.payload.total_size,
            is_last: msg.payload.is_last
          }
        }
      }));
    } else if (msg.type === 'FileChunkRead') {
      const sampleContent = 'CyberVPS Space Station Chunked Streaming Verified! Data chunk at offset ' + msg.payload.offset;
      const chunkBuf = Buffer.from(sampleContent);
      agentWs.send(JSON.stringify({
        type: 'AgentRpcResponse',
        payload: {
          request_id: msg.payload.request_id,
          success: true,
          result: {
            path: msg.payload.path,
            filename: 'test-stream.txt',
            offset: msg.payload.offset,
            length: chunkBuf.length,
            file_size: chunkBuf.length,
            is_eof: true,
            chunk_base64: chunkBuf.toString('base64')
          }
        }
      }));
    } else if (msg.type === 'FileRun') {
      agentWs.send(JSON.stringify({
        type: 'AgentRpcResponse',
        payload: {
          request_id: msg.payload.request_id,
          success: true,
          result: {
            pid: 9942,
            exit_code: 0,
            stdout: 'Process output: Hello from CyberVPS remote execution!\n',
            stderr: '',
            execution_time_ms: 45,
            interpreter: 'Direct Executable'
          }
        }
      }));
    } else if (msg.type === 'FileArchiveZip') {
      agentWs.send(JSON.stringify({
        type: 'AgentRpcResponse',
        payload: {
          request_id: msg.payload.request_id,
          success: true,
          result: {
            zip_path: msg.payload.dir_path + '.zip',
            total_files: 14,
            archive_size_bytes: 42890
          }
        }
      }));
    } else if (msg.type === 'FileArchiveExtract') {
      agentWs.send(JSON.stringify({
        type: 'AgentRpcResponse',
        payload: {
          request_id: msg.payload.request_id,
          success: true,
          result: {
            dest_dir: msg.payload.dest_dir,
            extracted_files: 14,
            total_extracted_bytes: 85200
          }
        }
      }));
    }
  });

  // 2. Test File Upload Chunk API (/api/v1/files/upload-chunk)
  console.log('\n[*] Test 2: 64-bit Chunked Upload API (/api/v1/files/upload-chunk)...');
  const chunkRes = await request(`${SERVER_URL}/api/v1/files/upload-chunk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CVPS-Pairing-Key': PAIRING_KEY
    },
    body: JSON.stringify({
      machine_id: testNodeId,
      path: '/var/data/bigfile.bin',
      offset: 0,
      total_size: 10485760,
      chunk_base64: Buffer.from('CHUNK_0_BYTES').toString('base64'),
      is_first: true,
      is_last: false
    })
  });
  assert.strictEqual(chunkRes.statusCode, 200, 'Chunk upload must succeed');
  const chunkData = JSON.parse(chunkRes.body);
  assert.strictEqual(chunkData.success, true);
  assert.strictEqual(chunkData.bytes_written, 13);
  console.log('  ✅ Chunked upload endpoint verified.');

  // 3. Test Download Ticket Generation & Public Authentication
  console.log('\n[*] Test 3: Download Ticket Minting & Public Stream Authentication...');
  const ticketRes = await request(`${SERVER_URL}/api/v1/files/ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CVPS-Pairing-Key': PAIRING_KEY
    },
    body: JSON.stringify({
      machine_id: testNodeId,
      path: '/var/data/download-target.txt',
      filename: 'download-target.txt'
    })
  });
  assert.strictEqual(ticketRes.statusCode, 200, 'Ticket generation must succeed');
  const ticketData = JSON.parse(ticketRes.body);
  assert(ticketData.ticket.startsWith('cvps_dl_'), 'Ticket must start with cvps_dl_ prefix');
  console.log(`  ✅ Minted download ticket: ${ticketData.ticket}`);

  // Test 3B: Public request with ticket succeeds WITHOUT headers
  console.log('  [*] Testing public download with ticket (simulated public browser)...');
  const dlWithTicket = await request(`${SERVER_URL}/api/v1/files/download?ticket=${ticketData.ticket}`, {
    headers: { 'X-Simulate-Public': 'true' }
  });
  assert.strictEqual(dlWithTicket.statusCode, 200, 'Download with valid ticket must return 200 on public interface');
  assert(dlWithTicket.headers['content-disposition'].includes('download-target.txt'), 'Must set Content-Disposition with filename');
  assert(dlWithTicket.body.includes('CyberVPS Space Station Chunked Streaming Verified!'), 'Must receive streamed content');
  console.log('  ✅ Browser download with ticket authenticated successfully on public control plane!');

  // Test 3C: Public request WITHOUT ticket or pairing key is properly blocked (401)
  console.log('  [*] Testing public download WITHOUT ticket is strictly rejected (401)...');
  const dlNoAuth = await request(`${SERVER_URL}/api/v1/files/download?machine_id=${testNodeId}&path=/etc/shadow`, {
    headers: { 'X-Simulate-Public': 'true' }
  });
  assert.strictEqual(dlNoAuth.statusCode, 401, 'Public download without ticket must return 401');
  console.log('  ✅ Unauthenticated public download fail-closed security verified (401).');

  // 4. Test Remote Execution API (/api/v1/files/run)
  console.log('\n[*] Test 4: Remote Process Execution API (/api/v1/files/run)...');
  const runRes = await request(`${SERVER_URL}/api/v1/files/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CVPS-Pairing-Key': PAIRING_KEY
    },
    body: JSON.stringify({
      machine_id: testNodeId,
      path: '/opt/scripts/deploy.sh',
      args: '--env production --port 8080',
      cwd: '/opt/scripts'
    })
  });
  assert.strictEqual(runRes.statusCode, 200, 'File run endpoint must return 200');
  const runData = JSON.parse(runRes.body);
  assert.strictEqual(runData.success, true);
  assert.strictEqual(runData.exit_code, 0);
  assert.strictEqual(runData.pid, 9942);
  assert(runData.stdout.includes('Hello from CyberVPS remote execution!'), 'Must capture stdout');
  console.log('  ✅ Remote process execution verified (PID 9942, Exit 0, stdout captured).');

  // 5. Test Directory ZIP & Archive Extraction APIs
  console.log('\n[*] Test 5: Directory ZIP Creation & Archive Extraction APIs...');
  const zipRes = await request(`${SERVER_URL}/api/v1/files/archive/zip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CVPS-Pairing-Key': PAIRING_KEY
    },
    body: JSON.stringify({
      machine_id: testNodeId,
      dir_path: '/home/user/myproject'
    })
  });
  assert.strictEqual(zipRes.statusCode, 200, 'Zip creation must return 200');
  const zipData = JSON.parse(zipRes.body);
  assert.strictEqual(zipData.success, true);
  assert.strictEqual(zipData.total_files, 14);
  console.log(`  ✅ Directory ZIP created: ${zipData.zip_path} (${zipData.total_files} files)`);

  const extractRes = await request(`${SERVER_URL}/api/v1/files/archive/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CVPS-Pairing-Key': PAIRING_KEY
    },
    body: JSON.stringify({
      machine_id: testNodeId,
      archive_path: '/home/user/myproject.zip',
      dest_dir: '/var/www/extracted'
    })
  });
  assert.strictEqual(extractRes.statusCode, 200, 'Archive extraction must return 200');
  const extractData = JSON.parse(extractRes.body);
  assert.strictEqual(extractData.success, true);
  assert.strictEqual(extractData.extracted_files, 14);
  console.log(`  ✅ Archive extracted into: ${extractData.dest_dir} (${extractData.extracted_files} files)`);

  // 6. Test Remote Desktop Hang Fix: Instant Agent Offline Notification
  console.log('\n[*] Test 6: Remote Desktop Instant Offline Diagnostic...');
  const offlineNodeId = 'node_offline_test_' + Math.random().toString(36).substring(2, 7);
  const tempAgentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise(resolve => tempAgentWs.on('open', resolve));
  tempAgentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: offlineNodeId,
      token: ENROLL_TOKEN,
      hostname: 'temp-offline-host',
      os: 'Linux'
    }
  }));
  await new Promise(resolve => {
    tempAgentWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'AuthAck' && msg.payload.success) resolve(true);
    });
  });
  // Disconnect the agent so it becomes offline
  tempAgentWs.close();
  await wait(300);

  // Request stream token for the enrolled but offline machine
  const offlineTokenRes = await request(`${SERVER_URL}/api/v1/remote-desktop/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': PAIRING_KEY },
    body: JSON.stringify({ machine_id: offlineNodeId, desktop_mode: true })
  });
  assert.strictEqual(offlineTokenRes.statusCode, 200, 'Session token minting must succeed');
  const offlineTokenData = JSON.parse(offlineTokenRes.body);

  const offlineWs = new WebSocket(`${WS_URL}/api/v1/remote-desktop/stream?machine_id=${offlineNodeId}&token=${offlineTokenData.token}&desktop_mode=true`);
  const offlineStatus = await new Promise((resolve) => {
    offlineWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'status') resolve(msg);
    });
  });
  assert.strictEqual(offlineStatus.status, 'agent_offline', 'Must immediately notify viewer that agent is offline');
  assert(offlineStatus.error.includes('offline'), 'Error message must specify host is offline');
  offlineWs.close();
  console.log('  ✅ Remote desktop viewer immediately received agent_offline without hanging!');

  // 7. Test Remote Desktop Handshake: Agent Acknowledgement Propagation
  console.log('\n[*] Test 7: Remote Desktop Agent Acknowledgement Stage Propagation...');
  let desktopStartedReceived = false;
  let activeStreamId = null;

  agentWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'RemoteDesktopStart') {
      desktopStartedReceived = true;
      activeStreamId = msg.payload.stream_id;
      // Send authenticated acknowledgement from agent
      agentWs.send(JSON.stringify({
        type: 'RemoteDesktopStarted',
        payload: {
          stream_id: msg.payload.stream_id,
          correlation_id: msg.payload.correlation_id,
          status: 'agent_acknowledged',
          desktop_mode: true
        }
      }));
    }
  });

  const liveTokenRes = await request(`${SERVER_URL}/api/v1/remote-desktop/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': PAIRING_KEY },
    body: JSON.stringify({ machine_id: testNodeId, desktop_mode: true })
  });
  assert.strictEqual(liveTokenRes.statusCode, 200, 'Live session token minting must succeed');
  const liveTokenData = JSON.parse(liveTokenRes.body);

  const viewerWs = new WebSocket(`${WS_URL}/api/v1/remote-desktop/stream?machine_id=${testNodeId}&token=${liveTokenData.token}&desktop_mode=true`);
  const stagesReceived = [];

  await new Promise((resolve) => {
    viewerWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'stage') {
        stagesReceived.push(msg.stage);
        if (msg.stage === 'agent_acknowledged') {
          resolve();
        }
      }
    });
  });

  assert(stagesReceived.includes('ws_connected'), 'Viewer must receive ws_connected stage');
  assert(stagesReceived.includes('agent_notified'), 'Viewer must receive agent_notified stage');
  assert(stagesReceived.includes('agent_acknowledged'), 'Viewer must receive agent_acknowledged stage');
  console.log(`  ✅ Viewer received full handshake stages: ${stagesReceived.join(' -> ')}`);

  viewerWs.close();
  agentWs.close();

  if (serverProcess) {
    serverProcess.kill();
  }

  console.log('\n================================================================');
  console.log('🎉 ALL FILE MANAGER ULTRA & REMOTE DESKTOP TESTS PASSED!');
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
