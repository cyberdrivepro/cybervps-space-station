/**
 * CYBERVPS SPACE STATION - FILE MANAGER DOWNLOAD & RUN VERIFICATION
 * Tests:
 * 1. Ticket generation with hostname 'DESKTOP-01CS69V' resolving to enrolled machine
 * 2. Download endpoint streaming with ticket generated using hostname
 * 3. File inspect with hostname 'DESKTOP-01CS69V'
 * 4. File run with hostname 'DESKTOP-01CS69V'
 * 5. .lnk shortcut execution detection
 * 6. Directory ZIP archive creation and download with hostname
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 8089;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;
const PAIRING_KEY = 'test_pair_key_fm_2026';
const ENROLL_TOKEN = 'test_enroll_token_fm_999';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
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

async function testFileManagerDownloadAndRun() {
  console.log('================================================================');
  console.log('🧪 VERIFYING FILE MANAGER DOWNLOAD, RUN & HOSTNAME RESOLUTION');
  console.log('================================================================\n');

  console.log('[*] Spawning local server instance on port ' + PORT + '...');
  const serverPath = path.join(__dirname, '../services/server.js');
  const serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PAIRING_KEY: PAIRING_KEY,
      CVPS_PAIRING_KEY: PAIRING_KEY,
      ENROLLMENT_TOKEN: ENROLL_TOKEN,
      ADMIN_SECRET: 'test_admin_secret_123',
      NODE_ENV: 'test'
    },
    stdio: 'ignore'
  });

  const cleanup = () => {
    try { if (serverProcess) serverProcess.kill('SIGTERM'); } catch (_) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  // Wait for server health
  let ok = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 300));
    const h = await request(`${SERVER_URL}/health`).catch(() => null);
    if (h && h.statusCode === 200) {
      ok = true;
      break;
    }
  }
  assert(ok, 'Failed to launch local test server');
  console.log('  ✅ Local server running on port ' + PORT + '.\n');

  const testNodeId = 'cvps_desktop01cs69v_' + Math.random().toString(36).substring(2, 7);
  const hostname = 'DESKTOP-01CS69V';

  console.log(`[*] Step 1: Connecting Agent RPC channel for ${testNodeId} with hostname ${hostname}...`);
  const agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise((resolve, reject) => {
    agentWs.on('open', resolve);
    agentWs.on('error', reject);
  });

  agentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: testNodeId,
      token: ENROLL_TOKEN,
      hostname: hostname,
      os: 'Windows'
    }
  }));

  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('Auth timed out')), 5000);
    agentWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'AuthAck' && msg.payload.success) {
        clearTimeout(to);
        resolve(true);
      }
    });
  });
  console.log('  ✅ Agent enrolled successfully.\n');

  // Setup agent responder for FileChunkRead, FileInspect, FileRun, FileArchiveZip
  agentWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const reqId = msg.payload?.request_id;
      if (!reqId) return;

      if (msg.type === 'FileChunkRead') {
        const dummyContent = Buffer.from('Shortcut contents for Arc.lnk: target=Arc.exe');
        agentWs.send(JSON.stringify({
          type: 'AgentRpcResponse',
          payload: {
            request_id: reqId,
            success: true,
            result: {
              chunk_base64: dummyContent.toString('base64'),
              file_size: dummyContent.length,
              is_eof: true,
              filename: 'Arc.lnk'
            }
          }
        }));
      } else if (msg.type === 'FileInspect') {
        agentWs.send(JSON.stringify({
          type: 'AgentRpcResponse',
          payload: {
            request_id: reqId,
            success: true,
            result: {
              path: msg.payload.path,
              filename: 'Arc.lnk',
              extension: '.lnk',
              file_type: 'shortcut',
              subsystem_name: 'Windows Shortcut (.lnk)',
              suggested_runner: 'cmd.exe /c start ""',
              is_admin: false,
              is_elevated: false,
              elevation_warning: false
            }
          }
        }));
      } else if (msg.type === 'FileRun') {
        agentWs.send(JSON.stringify({
          type: 'AgentRpcResponse',
          payload: {
            request_id: reqId,
            success: true,
            result: {
              job_id: 'run_test_123',
              pid: 9912,
              running: false,
              exit_code: 0,
              stdout: 'Application launched successfully',
              stderr: '',
              elevated: Boolean(msg.payload.run_as_admin)
            }
          }
        }));
      } else if (msg.type === 'FileArchiveZip') {
        agentWs.send(JSON.stringify({
          type: 'AgentRpcResponse',
          payload: {
            request_id: reqId,
            success: true,
            result: {
              zip_path: 'C:\\temp\\folder.zip',
              archive_path: 'C:\\temp\\folder.zip',
              total_files: 5,
              archive_size_bytes: 4096
            }
          }
        }));
      }
    } catch (_) {}
  });

  // Test 1: Ticket generation with hostname DESKTOP-01CS69V
  console.log('[*] Test 1: Generating download ticket using hostname "DESKTOP-01CS69V"...');
  const ticketRes = await request(`${SERVER_URL}/api/v1/files/ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CVPS-Pairing-Key': PAIRING_KEY
    },
    body: JSON.stringify({
      machine_id: hostname,
      path: 'C:\\Users\\Suraj\\Desktop\\Arc.lnk',
      filename: 'Arc.lnk'
    })
  });

  assert.strictEqual(ticketRes.statusCode, 200, 'Ticket status should be 200');
  const ticketJson = JSON.parse(ticketRes.body);
  assert.ok(ticketJson.ticket, 'Ticket should be present in response body');
  const dlTicket = ticketJson.ticket;
  console.log(`  ✅ Ticket successfully generated: ${dlTicket}`);

  // Test 2: Downloading file using the ticket
  console.log('\n[*] Test 2: Downloading file using ticket...');
  const dlRes = await request(`${SERVER_URL}/api/v1/files/download?ticket=${encodeURIComponent(dlTicket)}`);

  assert.strictEqual(dlRes.statusCode, 200, 'Download status should be 200');
  assert.ok(dlRes.headers['content-disposition'].includes('Arc.lnk'), 'Content-Disposition should contain filename');
  assert.ok(dlRes.body.includes('Shortcut contents for Arc.lnk'), 'Content should match streamed data');
  console.log(`  ✅ File stream received: ${dlRes.body.length} bytes, Disposition: ${dlRes.headers['content-disposition']}`);

  // Test 3: Inspect file using hostname
  console.log('\n[*] Test 3: Inspecting file with hostname "DESKTOP-01CS69V"...');
  const inspectRes = await request(`${SERVER_URL}/api/v1/files/inspect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CVPS-Pairing-Key': PAIRING_KEY
    },
    body: JSON.stringify({
      machine_id: hostname,
      path: 'C:\\Users\\Suraj\\Desktop\\Arc.lnk'
    })
  });

  assert.strictEqual(inspectRes.statusCode, 200, 'Inspect status should be 200');
  const inspectJson = JSON.parse(inspectRes.body);
  assert.strictEqual(inspectJson.file_type, 'shortcut', 'File type should be shortcut');
  console.log('  ✅ File inspection succeeded using hostname routing.');

  // Test 4: Run file using hostname
  console.log('\n[*] Test 4: Executing file with hostname "DESKTOP-01CS69V"...');
  const runRes = await request(`${SERVER_URL}/api/v1/files/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CVPS-Pairing-Key': PAIRING_KEY
    },
    body: JSON.stringify({
      machine_id: hostname,
      path: 'C:\\Users\\Suraj\\Desktop\\Arc.lnk',
      run_as_admin: false
    })
  });

  assert.strictEqual(runRes.statusCode, 200, 'Run status should be 200');
  const runJson = JSON.parse(runRes.body);
  assert.strictEqual(runJson.pid, 9912, 'PID should match agent response');
  assert.strictEqual(runJson.exit_code, 0, 'Exit code should be 0');
  console.log(`  ✅ File execution completed: PID=${runJson.pid}, ExitCode=${runJson.exit_code}`);

  // Test 5: Archive ZIP using hostname
  console.log('\n[*] Test 5: Creating folder ZIP archive with hostname "DESKTOP-01CS69V"...');
  const zipRes = await request(`${SERVER_URL}/api/v1/files/archive/zip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CVPS-Pairing-Key': PAIRING_KEY
    },
    body: JSON.stringify({
      machine_id: hostname,
      dir_path: 'C:\\Users\\Suraj\\Desktop\\MyFolder'
    })
  });

  assert.strictEqual(zipRes.statusCode, 200, 'Zip status should be 200');
  const zipJson = JSON.parse(zipRes.body);
  assert.ok(zipJson.zip_path || zipJson.archive_path, 'Zip path should be present');
  console.log('  ✅ Directory ZIP archive created successfully with hostname.');

  agentWs.close();
  cleanup();
  console.log('\n================================================================');
  console.log('🎉 ALL FILE MANAGER DOWNLOAD & RUN TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
  process.exit(0);
}

testFileManagerDownloadAndRun().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
