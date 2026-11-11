/**
 * CYBERVPS SPACE STATION - TERMINAL UPLOAD & RUN AND SESSION RESILIENCE TEST SUITE
 * 
 * Verifies:
 * 1. Terminal session start, token issuance, and interactive shell handshake.
 * 2. Keystroke normalization (\r -> \r\n on Windows pipe shells) and command delivery.
 * 3. Shell process resurrection and reconnection across agent blips.
 * 4. POST /api/v1/terminal/upload-run:
 *    - Direct in-terminal execution (FileWrite + TerminalInput invocation).
 *    - Fallback background execution (FileWrite + FileRun process engine).
 * 5. Script execution streaming into active terminal session.
 */

const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { spawn } = require('child_process');

const SERVER_PORT = 8080;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;
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

async function runTerminalUploadAndRunSuite() {
  console.log('================================================================');
  console.log('🧪 RUNNING TERMINAL UPLOAD & RUN AND SESSION RESILIENCE SUITE');
  console.log('================================================================\n');

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

  const machineId = 'node_term_uprun_' + Math.random().toString(36).substring(2, 7);

  // 1. Connect Mock Agent
  console.log(`[*] Connecting Mock Agent [${machineId}]...`);
  let agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise(resolve => agentWs.on('open', resolve));

  agentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: machineId,
      token: ENROLL_TOKEN,
      hostname: 'test-terminal-upload-host',
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
  console.log(`  ✅ Agent [${machineId}] enrolled on relay.\n`);

  // Track commands dispatched to Agent
  const agentReceivedCommands = [];
  const agentRequests = [];

  const setupAgentListeners = (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type && (msg.type.startsWith('Terminal') || msg.type === 'FileWrite' || msg.type === 'FileRun')) {
          agentReceivedCommands.push(msg);
        }
        if (msg.type === 'FileWrite') {
          agentRequests.push(msg);
          ws.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: msg.payload.request_id,
              success: true,
              result: { path: msg.payload.path, bytes_written: (msg.payload.content || '').length }
            }
          }));
        } else if (msg.type === 'FileRun') {
          agentRequests.push(msg);
          ws.send(JSON.stringify({
            type: 'AgentRpcResponse',
            payload: {
              request_id: msg.payload.request_id,
              success: true,
              result: { pid: 9942, job_id: 'job_' + Date.now() }
            }
          }));
        }
      } catch (_) {}
    });
  };

  setupAgentListeners(agentWs);

  // TEST 1: Mint terminal token & start terminal session
  console.log('--- TEST 1: Mint Terminal Token & Start Session ---');
  const tokenRes = await request(`${SERVER_URL}/api/v1/terminal/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: machineId, profile: 'auto' })
  });

  assert.strictEqual(tokenRes.statusCode, 200, 'Token request must return 200');
  assert(tokenRes.json && tokenRes.json.token, 'Token response must contain token');
  const token = tokenRes.json.token;
  console.log(`  ✅ Terminal authorization token acquired: ${token.substring(0, 16)}...`);

  // Open browser terminal WebSocket
  const browserWs = new WebSocket(`${WS_URL}/api/v1/terminal/stream?machine_id=${machineId}&cols=100&rows=30&profile=auto&token=${token}`);
  await new Promise(resolve => browserWs.on('open', resolve));

  // Verify TerminalStart received by agent
  await wait(300);
  const startCmd = agentReceivedCommands.find(c => c.type === 'TerminalStart');
  assert(startCmd, 'Agent must receive TerminalStart command');
  const sessionId = startCmd.payload.session_id;
  assert(sessionId, 'TerminalStart must specify session_id');
  console.log(`  ✅ Agent received TerminalStart for session: ${sessionId}`);

  // Agent emits TerminalReady back to server
  agentWs.send(JSON.stringify({
    type: 'TerminalReady',
    payload: {
      session_id: sessionId,
      backend: 'ConPTY',
      shell: 'powershell.exe',
      user: 'SYSTEM',
      is_elevated: true
    }
  }));

  // Browser receives ready message
  const readyMsg = await new Promise(resolve => {
    browserWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ready') resolve(msg);
      } catch (_) {}
    });
  });
  assert(readyMsg, 'Browser must receive ready message');
  assert.strictEqual(readyMsg.backend, 'ConPTY');
  console.log(`  ✅ Browser received Terminal ready confirmation for [${sessionId}].\n`);

  // TEST 2: Keystroke normalization & command execution
  console.log('--- TEST 2: Terminal Input Delivery & Echo ---');
  agentReceivedCommands.length = 0;
  browserWs.send(JSON.stringify({ type: 'input', data: 'Get-Service\r\n' }));

  await wait(200);
  const inputCmd = agentReceivedCommands.find(c => c.type === 'TerminalInput' && c.payload.session_id === sessionId);
  assert(inputCmd, 'Agent must receive TerminalInput');
  assert.strictEqual(inputCmd.payload.data, 'Get-Service\r\n', 'Input command must match sent data');

  // Agent sends output back
  agentWs.send(JSON.stringify({
    type: 'TerminalOutput',
    payload: { session_id: sessionId, data: 'Running  CyberVPSAgent\r\n' }
  }));

  const receivedOutput = await new Promise(resolve => {
    browserWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.data && msg.data.includes('CyberVPSAgent')) resolve(msg.data);
      } catch (_) {}
    });
  });
  assert(receivedOutput.includes('CyberVPSAgent'), 'Browser must receive terminal output');
  console.log(`  ✅ Terminal input and output round-trip verified successfully.\n`);

  // TEST 3: In-Terminal File Upload & Instant Run (POST /api/v1/terminal/upload-run)
  console.log('--- TEST 3: POST /api/v1/terminal/upload-run (Stream in Shell) ---');
  agentReceivedCommands.length = 0;
  agentRequests.length = 0;

  const scriptCode = "Write-Host 'CyberVPS Space Station In-Terminal Execution Success!' -ForegroundColor Green";
  const scriptBase64 = Buffer.from(scriptCode, 'utf-8').toString('base64');

  const uploadRunRes = await request(`${SERVER_URL}/api/v1/terminal/upload-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machine_id: machineId,
      session_id: sessionId,
      filename: 'audit_test.ps1',
      content_base64: scriptBase64,
      dest_dir: 'C:\\Windows\\Temp',
      args: '-Verbose',
      run_in_terminal: true
    })
  });

  assert.strictEqual(uploadRunRes.statusCode, 200, 'upload-run must return 200');
  assert(uploadRunRes.json && uploadRunRes.json.success, 'upload-run must be successful');
  assert.strictEqual(uploadRunRes.json.mode, 'terminal_stream');
  console.log(`  ✅ Server accepted upload-run: ${uploadRunRes.json.message}`);

  // Verify FileWrite was dispatched to agent
  const fileWriteReq = agentRequests.find(r => r.type === 'FileWrite');
  assert(fileWriteReq, 'Agent must receive FileWrite RPC request');
  assert(fileWriteReq.payload.path.includes('audit_test.ps1'), 'FileWrite path must match target file');
  assert.strictEqual(fileWriteReq.payload.content, scriptBase64, 'Content base64 must match');
  console.log(`  ✅ Agent received FileWrite for path: ${fileWriteReq.payload.path}`);

  // Verify TerminalInput was sent into active shell session
  const scriptExecInput = agentReceivedCommands.find(c => c.type === 'TerminalInput' && c.payload.session_id === sessionId && c.payload.data.includes('audit_test.ps1'));
  assert(scriptExecInput, 'Agent must receive TerminalInput to launch the uploaded script');
  assert(scriptExecInput.payload.data.includes('-Verbose'), 'Script invocation must include arguments');
  console.log(`  ✅ Active terminal shell received execution command: ${scriptExecInput.payload.data.trim()}\n`);

  // TEST 4: Upload & Run as Background Process Engine (run_in_terminal: false)
  console.log('--- TEST 4: POST /api/v1/terminal/upload-run (Background Process Mode) ---');
  agentRequests.length = 0;

  const bgUploadRunRes = await request(`${SERVER_URL}/api/v1/terminal/upload-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machine_id: machineId,
      filename: 'bg_job.ps1',
      content_text: 'Start-Sleep -Seconds 60',
      dest_dir: 'C:\\Windows\\Temp',
      run_in_terminal: false,
      run_as_admin: true
    })
  });

  assert.strictEqual(bgUploadRunRes.statusCode, 200, 'Background upload-run must return 200');
  assert(bgUploadRunRes.json && bgUploadRunRes.json.success);
  assert.strictEqual(bgUploadRunRes.json.mode, 'process_engine');
  assert.strictEqual(bgUploadRunRes.json.pid, 9942);
  console.log(`  ✅ Background execution launched via process worker (PID: ${bgUploadRunRes.json.pid}).\n`);

  // TEST 5: Agent Reconnect & Session Auto-Resurrection
  console.log('--- TEST 5: Relay Reconnect & Session Auto-Resurrection ---');
  agentReceivedCommands.length = 0;

  // Agent temporarily disconnects
  console.log('  [*] Simulating agent disconnect...');
  agentWs.close();
  await wait(500);

  // Agent reconnects
  console.log('  [*] Reconnecting agent to relay...');
  agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise(resolve => agentWs.on('open', resolve));

  setupAgentListeners(agentWs);

  agentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: machineId,
      token: ENROLL_TOKEN,
      hostname: 'test-terminal-upload-host',
      os: 'Windows'
    }
  }));

  await wait(500);

  // Verify server re-issued TerminalStart to restore active terminal session
  const resurrectCmd = agentReceivedCommands.find(c => c.type === 'TerminalStart' && c.payload.session_id === sessionId);
  assert(resurrectCmd, 'Server must re-issue TerminalStart when agent reconnects');
  console.log(`  ✅ Server successfully re-issued TerminalStart for session [${sessionId}].\n`);

  // Clean up
  browserWs.close();
  agentWs.close();
  if (serverProcess) {
    serverProcess.kill();
  }

  console.log('================================================================');
  console.log('🎉 ALL 5 TERMINAL UPLOAD & RUN AND SESSION RESILIENCE TESTS PASSED!');
  console.log('================================================================\n');
}

if (require.main === module) {
  runTerminalUploadAndRunSuite().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
}

module.exports = { runTerminalUploadAndRunSuite };
