/**
 * CYBERVPS SPACE STATION - ELEVATION 740, DOWNLOAD TICKETS, MULTI-ZIP, & RESUMABLE UPLOADS
 * End-to-end integration test suite verifying the 5 critical production repairs.
 */

const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const SERVER_URL = 'http://127.0.0.1:8080';
const WS_URL = 'ws://127.0.0.1:8080';
const PAIRING_KEY = process.env.PAIRING_KEY || process.env.CVPS_PAIRING_KEY || 'cybervps_pair_station_2026';

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
  console.log('🧪 VERIFYING ELEVATION 740, TICKET AUTH, MULTI-ZIP & RESUMABLE UPLOADS');
  console.log('================================================================\n');

  // Ensure server is up
  let serverProcess = null;
  const health = await request(`${SERVER_URL}/health`).catch(() => null);
  if (!health || health.statusCode !== 200) {
    console.log('[*] Spawning local server instance...');
    const serverPath = path.join(__dirname, '../services/server.js');
    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        PORT: '8080',
        PAIRING_KEY: PAIRING_KEY,
        CVPS_PAIRING_KEY: PAIRING_KEY,
        ENROLLMENT_TOKEN: 'test_enroll_token_999',
        ADMIN_SECRET: 'test_admin_secret_123',
        NODE_ENV: 'test'
      },
      stdio: 'pipe'
    });
    let ok = false;
    for (let i = 0; i < 30; i++) {
      await wait(300);
      const h = await request(`${SERVER_URL}/health`).catch(() => null);
      if (h && h.statusCode === 200) {
        ok = true;
        break;
      }
    }
    assert(ok, 'Failed to launch local test server');
    console.log('  ✅ Local server running on port 8080.');
  } else {
    console.log('  ✅ Local server is already running.');
  }

  // 1. Connect mock Windows agent
  const testNodeId = 'cvps_desktop01cs69v_' + Math.random().toString(36).substring(2, 7);
  console.log(`\n[*] Step 1: Connecting Agent RPC channel for ${testNodeId}...`);

  const agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise((resolve, reject) => {
    agentWs.on('open', resolve);
    agentWs.on('error', reject);
  });

  agentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: testNodeId,
      token: 'test_enroll_token_999',
      hostname: 'DESKTOP-01CS69V',
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
  console.log(`  ✅ Agent ${testNodeId} enrolled and connected.`);

  // Set up mock agent command responder
  const stagingStorage = new Map();

  agentWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const reqId = msg.payload && msg.payload.request_id;

      if (msg.type === 'FileRun') {
        const p = msg.payload.path;
        const runAsAdmin = Boolean(msg.payload.run_as_admin || msg.payload.request_uac);

        if (p.includes('needs_admin.exe') && !runAsAdmin) {
          // Simulate WinError 740
          agentWs.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: reqId,
              success: false,
              code: 'ELEVATION_REQUIRED',
              status: 422,
              requires_elevation: true,
              error: '[WinError 740] The requested operation requires elevation'
            }
          }));
        } else if (p.includes('needs_admin.exe') && runAsAdmin) {
          // Elevated execution success
          agentWs.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: reqId,
              success: true,
              result: {
                pid: 7712,
                running: true,
                elevated: true,
                stdout: 'Elevated process launched successfully via ShellExecuteExW(runas)',
                exit_code: null
              }
            }
          }));
        } else {
          agentWs.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: reqId,
              success: true,
              result: { pid: 1234, running: false, elevated: false, exit_code: 0, stdout: 'OK' }
            }
          }));
        }
      } else if (msg.type === 'FileUploadStatus') {
        const p = msg.payload.path;
        if (stagingStorage.has(p + '.cvps_part')) {
          const sz = stagingStorage.get(p + '.cvps_part').length;
          agentWs.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: reqId,
              success: true,
              result: {
                exists: true,
                is_partial: true,
                offset: sz,
                committed_offset: sz,
                total_size: sz
              }
            }
          }));
        } else if (stagingStorage.has(p)) {
          const sz = stagingStorage.get(p).length;
          agentWs.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: reqId,
              success: true,
              result: {
                exists: true,
                is_partial: false,
                offset: sz,
                committed_offset: sz,
                total_size: sz
              }
            }
          }));
        } else {
          agentWs.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: reqId,
              success: true,
              result: { exists: false, is_partial: false, offset: 0, committed_offset: 0 }
            }
          }));
        }
      } else if (msg.type === 'FileChunkWrite') {
        const p = msg.payload.path;
        const off = msg.payload.offset;
        const b64 = msg.payload.chunk_data_base64;
        const isLast = msg.payload.is_last;
        const partKey = p + '.cvps_part';

        let existing = stagingStorage.get(partKey) || Buffer.alloc(0);
        const chunkBuf = Buffer.from(b64, 'base64');
        const newBuf = Buffer.concat([existing, chunkBuf]);
        stagingStorage.set(partKey, newBuf);

        if (isLast) {
          stagingStorage.set(p, newBuf);
          stagingStorage.delete(partKey);
        }

        agentWs.send(JSON.stringify({
          type: 'AgentRpcResponse',
          payload: {
            request_id: reqId,
            success: true,
            result: {
              path: p,
              offset: off,
              bytes_written: chunkBuf.length,
              committed_offset: off + chunkBuf.length,
              total_size: newBuf.length,
              is_last: isLast
            }
          }
        }));
      } else if (msg.type === 'FileArchiveZip') {
        const paths = msg.payload.paths || [msg.payload.dir_path || msg.payload.path];
        agentWs.send(JSON.stringify({
          type: 'AgentRpcResponse',
          payload: {
            request_id: reqId,
            success: true,
            result: {
              zip_path: 'C:/temp/archive_test.zip',
              archive_path: 'C:/temp/archive_test.zip',
              total_files: paths.length * 3,
              total_size: 1048576,
              archive_size_bytes: 524288
            }
          }
        }));
      } else if (msg.type === 'FileChunkRead') {
        agentWs.send(JSON.stringify({
          type: 'AgentRpcResponse',
          payload: {
            request_id: reqId,
            success: true,
            result: {
              chunk_base64: Buffer.from('TEST CONTENT FOR STREAMING').toString('base64'),
              is_eof: true,
              file_size: 26,
              filename: 'test_file.txt'
            }
          }
        }));
      }
    } catch (_) {}
  });

  // Give WS handshake 500ms
  await wait(500);

  // ================================================================
  // TEST 1: Windows Elevation WinError 740 detection & 422 response
  // ================================================================
  console.log('\n[*] Test 1: Remote Execution WinError 740 detection & 422 ELEVATION_REQUIRED...');
  const runWithoutAdminRes = await request(`${SERVER_URL}/api/v1/files/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': PAIRING_KEY },
    body: JSON.stringify({
      machine_id: testNodeId,
      path: 'C:/Program Files/Setup/needs_admin.exe',
      run_as_admin: false
    })
  });

  assert.strictEqual(runWithoutAdminRes.statusCode, 422, 'WinError 740 must return HTTP status 422');
  const runWithoutAdminBody = JSON.parse(runWithoutAdminRes.body);
  assert.strictEqual(runWithoutAdminBody.code, 'ELEVATION_REQUIRED', 'Response code must be ELEVATION_REQUIRED');
  assert.strictEqual(runWithoutAdminBody.requires_elevation, true, 'requires_elevation flag must be true');
  console.log('  ✅ Unprivileged attempt correctly rejected with 422 ELEVATION_REQUIRED and requires_elevation=true.');

  // ================================================================
  // TEST 2: Remote Execution with run_as_admin: true
  // ================================================================
  console.log('\n[*] Test 2: Remote Execution with run_as_admin: true (ShellExecuteExW elevation)...');
  const runWithAdminRes = await request(`${SERVER_URL}/api/v1/files/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': PAIRING_KEY },
    body: JSON.stringify({
      machine_id: testNodeId,
      path: 'C:/Program Files/Setup/needs_admin.exe',
      run_as_admin: true
    })
  });

  assert.strictEqual(runWithAdminRes.statusCode, 200, 'Elevated execution must succeed with HTTP 200');
  const runWithAdminBody = JSON.parse(runWithAdminRes.body);
  assert.strictEqual(runWithAdminBody.elevated, true, 'Result must indicate elevated=true');
  assert.strictEqual(runWithAdminBody.pid, 7712, 'Result must return valid elevated PID');
  console.log('  ✅ Elevated process execution succeeded with real PID 7712 and elevated=true.');

  // ================================================================
  // TEST 3: Public Download Ticket Lifecycle & Replay Protection
  // ================================================================
  console.log('\n[*] Test 3: Public Download Ticket Lifecycle & Replay Protection...');
  
  // 3a: Mint ticket
  const mintTicketRes = await request(`${SERVER_URL}/api/v1/files/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': PAIRING_KEY },
    body: JSON.stringify({
      machine_id: testNodeId,
      path: 'C:/data/test_file.txt',
      filename: 'test_file.txt'
    })
  });
  assert.strictEqual(mintTicketRes.statusCode, 200, 'Ticket minting must succeed');
  const { ticket } = JSON.parse(mintTicketRes.body);
  assert(ticket && ticket.startsWith('cvps_dl_'), 'Valid ticket format expected');

  // 3b: First public download with ticket (simulated public browser) -> MUST SUCCEED (200)
  const download1 = await request(`${SERVER_URL}/api/v1/files/download?ticket=${encodeURIComponent(ticket)}`, {
    headers: { 'X-Simulate-Public': 'true' }
  });
  assert.strictEqual(download1.statusCode, 200, 'First download using ticket must succeed with 200');
  assert(download1.body.includes('TEST CONTENT FOR STREAMING'), 'Download body must contain streamed data');
  console.log('  ✅ First download with valid ticket succeeded (HTTP 200).');

  // 3c: Replay attempt with same ticket -> MUST BE REJECTED (401 TICKET_ALREADY_USED)
  const downloadReplay = await request(`${SERVER_URL}/api/v1/files/download?ticket=${encodeURIComponent(ticket)}`, {
    headers: { 'X-Simulate-Public': 'true' }
  });
  assert.strictEqual(downloadReplay.statusCode, 401, 'Replay of consumed ticket must return 401');
  const replayBody = JSON.parse(downloadReplay.body);
  assert.strictEqual(replayBody.code, 'TICKET_ALREADY_USED', 'Replay must return TICKET_ALREADY_USED');
  console.log('  ✅ Replay attack prevented: Consumed ticket rejected with 401 TICKET_ALREADY_USED.');

  // 3d: Fake ticket -> MUST BE REJECTED (401 INVALID_TICKET)
  const fakeTicketDl = await request(`${SERVER_URL}/api/v1/files/download?ticket=cvps_dl_fake_invalid_ticket`, {
    headers: { 'X-Simulate-Public': 'true' }
  });
  assert.strictEqual(fakeTicketDl.statusCode, 401, 'Fake ticket must return 401');
  const fakeBody = JSON.parse(fakeTicketDl.body);
  assert.strictEqual(fakeBody.code, 'INVALID_TICKET', 'Fake ticket must return INVALID_TICKET');
  console.log('  ✅ Nonexistent ticket rejected with 401 INVALID_TICKET.');

  // 3e: Public download without any ticket -> MUST BE REJECTED (401)
  const unauthDl = await request(`${SERVER_URL}/api/v1/files/download?machine_id=${testNodeId}&path=C:/test.txt`, {
    headers: { 'X-Simulate-Public': 'true' }
  });
  assert.strictEqual(unauthDl.statusCode, 401, 'Unauthenticated public request without ticket must return 401');
  console.log('  ✅ Unauthenticated public download blocked with 401.');

  // ================================================================
  // TEST 4: Resumable Chunked Upload with .cvps_part Staging
  // ================================================================
  console.log('\n[*] Test 4: Resumable Chunked Upload with .cvps_part Staging...');
  const uploadDestPath = 'C:/Uploads/large_dataset.iso';

  // 4a: Send chunk 1 (2 MB)
  const chunk1Data = Buffer.alloc(2 * 1024 * 1024, 0x41).toString('base64');
  const chunk1Res = await request(`${SERVER_URL}/api/v1/files/upload-chunk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': PAIRING_KEY },
    body: JSON.stringify({
      machine_id: testNodeId,
      path: uploadDestPath,
      offset: 0,
      total_size: 4 * 1024 * 1024,
      chunk_base64: chunk1Data,
      is_first: true,
      is_last: false
    })
  });
  assert.strictEqual(chunk1Res.statusCode, 200, 'Chunk 1 upload must succeed');

  // 4b: Check upload status to verify staging exists and resume offset
  const statusRes = await request(`${SERVER_URL}/api/v1/files/upload-status?machine_id=${testNodeId}&path=${encodeURIComponent(uploadDestPath)}`, {
    headers: { 'X-CVPS-Pairing-Key': PAIRING_KEY }
  });
  assert.strictEqual(statusRes.statusCode, 200, 'Upload status endpoint must succeed');
  const statusBody = JSON.parse(statusRes.body);
  assert.strictEqual(statusBody.is_partial, true, 'Status must report is_partial=true');
  assert.strictEqual(statusBody.offset, 2 * 1024 * 1024, 'Status must report 2 MB committed offset');
  console.log(`  ✅ Staging verified: Host reports partial file at offset ${statusBody.offset} bytes.`);

  // 4c: Send final chunk 2 (2 MB) with is_last=true
  const chunk2Data = Buffer.alloc(2 * 1024 * 1024, 0x42).toString('base64');
  const chunk2Res = await request(`${SERVER_URL}/api/v1/files/upload-chunk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': PAIRING_KEY },
    body: JSON.stringify({
      machine_id: testNodeId,
      path: uploadDestPath,
      offset: 2 * 1024 * 1024,
      total_size: 4 * 1024 * 1024,
      chunk_base64: chunk2Data,
      is_first: false,
      is_last: true
    })
  });
  assert.strictEqual(chunk2Res.statusCode, 200, 'Final chunk upload must succeed');

  // 4d: Check final status -> is_partial must now be false, total_size = 4 MB
  const finalStatusRes = await request(`${SERVER_URL}/api/v1/files/upload-status?machine_id=${testNodeId}&path=${encodeURIComponent(uploadDestPath)}`, {
    headers: { 'X-CVPS-Pairing-Key': PAIRING_KEY }
  });
  const finalStatus = JSON.parse(finalStatusRes.body);
  assert.strictEqual(finalStatus.is_partial, false, 'Final status must report is_partial=false after atomic commit');
  assert.strictEqual(finalStatus.total_size, 4 * 1024 * 1024, 'Final size must match total bytes written (4 MB)');
  console.log('  ✅ Atomic commit verified: .cvps_part replaced by final committed file (4 MB).');

  // ================================================================
  // TEST 5: Multi-item ZIP Archive Creation
  // ================================================================
  console.log('\n[*] Test 5: Multi-item ZIP Archive Creation API...');
  const multiZipRes = await request(`${SERVER_URL}/api/v1/files/archive/zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': PAIRING_KEY },
    body: JSON.stringify({
      machine_id: testNodeId,
      paths: ['C:/Users/Suraj/Desktop/file1.pdf', 'C:/Users/Suraj/Desktop/Projects', 'C:/Users/Suraj/Desktop/app.exe']
    })
  });
  assert.strictEqual(multiZipRes.statusCode, 200, 'Multi-item ZIP creation must succeed');
  const multiZipBody = JSON.parse(multiZipRes.body);
  assert(multiZipBody.zip_path || multiZipBody.archive_path, 'Result must contain zip_path or archive_path');
  assert.strictEqual(multiZipBody.total_files, 9, 'Result must report total files compressed');
  console.log(`  ✅ Multi-item ZIP archive created: ${multiZipBody.zip_path} (${multiZipBody.total_files} files, ${multiZipBody.archive_size_bytes} bytes).`);

  // Clean up
  agentWs.close();
  if (serverProcess) {
    serverProcess.kill();
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 5 CRITICAL PRODUCTION REPAIR TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
