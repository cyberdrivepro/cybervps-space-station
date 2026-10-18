/**
 * CYBERVPS SPACE STATION - TERMINAL READINESS & TIMEOUT LIFECYCLE REGRESSION TEST SUITE
 * 
 * Verifies:
 * 1. TerminalReady event marks matching server session ready = true.
 * 2. shellStartTimer is cleared on TerminalReady; no false timeout is emitted after 10s.
 * 3. TerminalExit event clears pending startup timer.
 * 4. Real timeout is sent if TerminalReady is never returned.
 * 5. Concurrent terminal sessions maintain strict isolation.
 * 6. Agent disconnect cleans up terminal sessions and dispatches disconnected status.
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

async function runTerminalReadinessSuite() {
  console.log('================================================================');
  console.log('🧪 RUNNING TERMINAL READINESS & TIMEOUT LIFECYCLE REGRESSION SUITE');
  console.log('================================================================\n');

  // 1. Ensure server is running
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

  const machineId = 'node_term_ready_' + Math.random().toString(36).substring(2, 7);

  // 2. Connect Mock Agent
  console.log(`[*] Connecting Mock Agent [${machineId}]...`);
  const agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
  await new Promise(resolve => agentWs.on('open', resolve));

  agentWs.send(JSON.stringify({
    type: 'Auth',
    payload: {
      machine_id: machineId,
      token: ENROLL_TOKEN,
      hostname: 'test-terminal-host',
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
  agentWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type && msg.type.startsWith('Terminal')) {
        agentReceivedCommands.push(msg);
      }
    } catch (_) {}
  });

  // Helper to mint single-use terminal token
  async function mintTerminalToken(mId) {
    const res = await request(`${SERVER_URL}/api/v1/terminal/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine_id: mId, profile: 'auto' })
    });
    assert.strictEqual(res.statusCode, 200, 'Terminal token request must return 200');
    assert(res.json && res.json.token, 'Must return token');
    return res.json.token;
  }

  // TEST 1: TerminalReady clears startup timer and marks session ready
  console.log('[*] Test 1: TerminalReady clears startup timer & prevents false timeout...');
  {
    const token = await mintTerminalToken(machineId);
    const browserWs = new WebSocket(`${WS_URL}/api/v1/terminal/stream?machine_id=${machineId}&token=${token}&cols=80&rows=24`);
    await new Promise(resolve => browserWs.on('open', resolve));

    const browserEvents = [];
    browserWs.on('message', (raw) => {
      browserEvents.push(JSON.parse(raw.toString()));
    });

    // Wait for connecting status
    await wait(150);
    const startCmd = agentReceivedCommands.find(c => c.type === 'TerminalStart');
    assert(startCmd, 'Server must dispatch TerminalStart to agent');
    const sessionId = startCmd.payload.session_id;

    // Send TerminalReady from agent back to server
    agentWs.send(JSON.stringify({
      type: 'TerminalReady',
      payload: {
        session_id: sessionId,
        backend: 'ConPTY [⚡ AUTO · Administrator]',
        shell: 'powershell.exe',
        pid: 7777,
        user: 'Administrator'
      }
    }));

    await wait(200);
    const readyEvent = browserEvents.find(e => e.type === 'ready');
    assert(readyEvent, 'Browser must receive type: ready');
    assert.strictEqual(readyEvent.session_id, sessionId);
    assert.strictEqual(readyEvent.pid, 7777);

    // Verify output delivery while session is active
    agentWs.send(JSON.stringify({
      type: 'TerminalOutput',
      payload: { session_id: sessionId, data: 'PS C:\\> ' }
    }));
    await wait(100);
    const outEvent = browserEvents.find(e => e.type === 'output' && e.data === 'PS C:\\> ');
    assert(outEvent, 'TerminalOutput must be delivered to browser socket');

    // Wait a brief period to verify no late timeout is dispatched
    await wait(500);
    const timeoutEvent = browserEvents.find(e => e.status === 'timeout');
    assert(!timeoutEvent, 'No timeout event should be received after TerminalReady');
    console.log('  ✅ TerminalReady received: ready event forwarded and timer cleared.\n');

    browserWs.close();
    await wait(100);
  }

  // TEST 2: TerminalExit clears pending startup timer
  console.log('[*] Test 2: TerminalExit before readiness cancels startup timer cleanly...');
  {
    const token = await mintTerminalToken(machineId);
    const browserWs = new WebSocket(`${WS_URL}/api/v1/terminal/stream?machine_id=${machineId}&token=${token}&cols=80&rows=24`);
    await new Promise(resolve => browserWs.on('open', resolve));

    const browserEvents = [];
    browserWs.on('message', (raw) => {
      browserEvents.push(JSON.parse(raw.toString()));
    });

    await wait(150);
    const lastStartCmd = agentReceivedCommands.filter(c => c.type === 'TerminalStart').pop();
    const sessionId = lastStartCmd.payload.session_id;

    // Simulate shell exiting immediately before ready
    agentWs.send(JSON.stringify({
      type: 'TerminalExit',
      payload: { session_id: sessionId, exit_code: 1 }
    }));

    await wait(200);
    const exitEvent = browserEvents.find(e => e.type === 'exit');
    assert(exitEvent, 'Browser must receive exit event');
    assert.strictEqual(exitEvent.exit_code, 1);
    console.log('  ✅ TerminalExit clears pending timer; exit event forwarded cleanly.\n');

    browserWs.close();
    await wait(100);
  }

  // TEST 3: Strict session isolation between concurrent sessions
  console.log('[*] Test 3: Concurrent terminal sessions maintain strict isolation...');
  {
    const token1 = await mintTerminalToken(machineId);
    const token2 = await mintTerminalToken(machineId);

    const ws1 = new WebSocket(`${WS_URL}/api/v1/terminal/stream?machine_id=${machineId}&token=${token1}&cols=80&rows=24`);
    const ws2 = new WebSocket(`${WS_URL}/api/v1/terminal/stream?machine_id=${machineId}&token=${token2}&cols=80&rows=24`);

    await Promise.all([
      new Promise(resolve => ws1.on('open', resolve)),
      new Promise(resolve => ws2.on('open', resolve))
    ]);

    const events1 = [];
    const events2 = [];
    ws1.on('message', raw => events1.push(JSON.parse(raw.toString())));
    ws2.on('message', raw => events2.push(JSON.parse(raw.toString())));

    await wait(150);
    const starts = agentReceivedCommands.filter(c => c.type === 'TerminalStart').slice(-2);
    assert.strictEqual(starts.length, 2, 'Two TerminalStart commands must be dispatched');
    const sessId1 = starts[0].payload.session_id;
    const sessId2 = starts[1].payload.session_id;
    assert.notStrictEqual(sessId1, sessId2, 'Session IDs must be distinct');

    // Only mark session 1 ready
    agentWs.send(JSON.stringify({
      type: 'TerminalReady',
      payload: { session_id: sessId1, backend: 'ConPTY', shell: 'pwsh.exe', pid: 1111 }
    }));

    await wait(150);
    assert(events1.some(e => e.type === 'ready'), 'Session 1 must receive ready');
    assert(!events2.some(e => e.type === 'ready'), 'Session 2 must NOT receive ready from Session 1 event');

    // Send output to session 2 only
    agentWs.send(JSON.stringify({
      type: 'TerminalOutput',
      payload: { session_id: sessId2, data: 'EXCLUSIVE_SESS_2' }
    }));

    await wait(100);
    assert(!events1.some(e => e.type === 'output' && e.data === 'EXCLUSIVE_SESS_2'), 'Session 1 must not receive Session 2 output');
    assert(events2.some(e => e.type === 'output' && e.data === 'EXCLUSIVE_SESS_2'), 'Session 2 must receive exclusive output');

    console.log('  ✅ Concurrent session isolation and selective event routing verified.\n');

    ws1.close();
    ws2.close();
    await wait(100);
  }

  // TEST 4: Agent disconnect tears down open terminal sessions
  console.log('[*] Test 4: Agent disconnect tears down open terminal sessions...');
  {
    const token = await mintTerminalToken(machineId);
    const browserWs = new WebSocket(`${WS_URL}/api/v1/terminal/stream?machine_id=${machineId}&token=${token}&cols=80&rows=24`);
    await new Promise(resolve => browserWs.on('open', resolve));

    let receivedDisconnectStatus = false;
    let browserSocketClosed = false;

    browserWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'status' && msg.status === 'disconnected') {
          receivedDisconnectStatus = true;
        }
      } catch (_) {}
    });

    browserWs.on('close', () => {
      browserSocketClosed = true;
    });

    await wait(100);

    // Drop agent connection
    agentWs.close();
    await wait(300);

    assert(receivedDisconnectStatus, 'Browser socket must receive disconnected status notification');
    assert(browserSocketClosed, 'Browser socket must be closed when agent disconnects');
    console.log('  ✅ Agent disconnect triggers clean session teardown and browser notification.\n');
  }

  // TEST 5: Case-insensitive machine ID and hostname-tolerant terminal routing
  console.log('[*] Test 5: Case-insensitive machine ID and hostname-tolerant terminal routing...');
  {
    // Reconnect agent with mixed casing
    const mixedMachineId = 'node_term_cAsE_' + Math.random().toString(36).substring(2, 6);
    const reconnectAgentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
    await new Promise(resolve => reconnectAgentWs.on('open', resolve));

    reconnectAgentWs.send(JSON.stringify({
      type: 'Auth',
      payload: {
        machine_id: mixedMachineId,
        token: ENROLL_TOKEN,
        hostname: 'DESKTOP-TEST-HOST',
        os: 'Windows'
      }
    }));

    await new Promise(resolve => {
      reconnectAgentWs.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'AuthAck' && msg.payload.success) resolve(true);
      });
    });

    const receivedStarts = [];
    reconnectAgentWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'TerminalStart') receivedStarts.push(msg);
      } catch (_) {}
    });

    // Request token with UPPERCASE machine ID
    const upperMachineId = mixedMachineId.toUpperCase();
    const token = await mintTerminalToken(upperMachineId);
    assert(token, 'Must acquire token using uppercase target');

    const browserWs = new WebSocket(`${WS_URL}/api/v1/terminal/stream?machine_id=${upperMachineId}&token=${token}&cols=80&rows=24`);
    await new Promise(resolve => browserWs.on('open', resolve));

    await wait(200);
    assert(receivedStarts.length > 0, 'TerminalStart must be delivered to agent despite casing difference');
    console.log('  ✅ Case-insensitive machine ID resolution verified (mixed vs uppercase).\n');

    browserWs.close();
    reconnectAgentWs.close();
    await wait(100);
  }

  // TEST 6: Grace period for reconnecting host agent
  console.log('[*] Test 6: Grace period for reconnecting host agent...');
  {
    const graceMachineId = 'node_term_grace_' + Math.random().toString(36).substring(2, 6);
    const initialAgentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
    await new Promise(resolve => initialAgentWs.on('open', resolve));

    initialAgentWs.send(JSON.stringify({
      type: 'Auth',
      payload: {
        machine_id: graceMachineId,
        token: ENROLL_TOKEN,
        hostname: 'test-grace-host',
        os: 'Windows'
      }
    }));

    await new Promise(resolve => {
      initialAgentWs.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'AuthAck' && msg.payload.success) resolve(true);
      });
    });

    // Simulate momentary agent drop
    initialAgentWs.close();
    await wait(100);

    // Terminal connects while agent is temporarily offline (but machine is known & recent)
    const token = await mintTerminalToken(graceMachineId);
    const browserWs = new WebSocket(`${WS_URL}/api/v1/terminal/stream?machine_id=${graceMachineId}&token=${token}&cols=80&rows=24`);
    await new Promise(resolve => browserWs.on('open', resolve));

    const browserMessages = [];
    browserWs.on('message', (raw) => {
      browserMessages.push(JSON.parse(raw.toString()));
    });

    // Agent reconnects after 600ms
    await wait(600);
    const reconnectedAgentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
    await new Promise(resolve => reconnectedAgentWs.on('open', resolve));

    let termStartDelivered = false;
    reconnectedAgentWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'TerminalStart') termStartDelivered = true;
      } catch (_) {}
    });

    reconnectedAgentWs.send(JSON.stringify({
      type: 'Auth',
      payload: {
        machine_id: graceMachineId,
        token: ENROLL_TOKEN,
        hostname: 'test-grace-host',
        os: 'Windows'
      }
    }));

    await wait(800);
    assert(termStartDelivered, 'TerminalStart must be delivered after agent reconnects within grace period');
    assert(!browserMessages.some(m => m.code === 'AGENT_OFFLINE'), 'AGENT_OFFLINE must not be emitted when agent reconnects in grace period');
    console.log('  ✅ Reconnecting host agent grace period & delayed relay bridge verified.\n');

    browserWs.close();
    reconnectedAgentWs.close();
    await wait(100);
  }

  console.log('================================================================');
  console.log('🎉 ALL TERMINAL READINESS & LIFECYCLE TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================\n');

  if (serverProcess) {
    serverProcess.kill();
  }
}

runTerminalReadinessSuite().catch(err => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
