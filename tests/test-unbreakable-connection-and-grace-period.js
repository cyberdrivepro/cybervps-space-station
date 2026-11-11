/**
 * CYBERVPS SPACE STATION - UNBREAKABLE ZERO-DROP CONNECTION & USER-PERMISSION TEST SUITE
 * 
 * Verifies:
 * 1. Zero-Drop Persistence: An enrolled host is NEVER automatically marked offline on transient drops.
 * 2. Grace Period Session Resumption: Terminal sessions & streams hold seamlessly during blips.
 * 3. Command Queuing Resilience: Requests while reconnecting do not fail with 503; they are queued.
 * 4. User-Permission Disconnect Guard: Host disconnect can ONLY occur with explicit user authorization.
 * 5. DisconnectOrder & Reconnect Cycle: Host parks when disconnected and resumes upon user reconnect.
 */

const http = require('http');
const WebSocket = require('ws');
const assert = require('assert');

process.env.PORT = '9974';
process.env.ENROLLMENT_TOKEN = 'test_unbreakable_token_123';
process.env.NODE_ENV = 'test';

const { server, db, getMachineStatus, sendAgentRequest, sendServerCommand } = require('../services/server');

const TEST_PORT = 9974;
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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING UNBREAKABLE CONNECTION & USER DISCONNECT TEST SUITE');
  console.log('================================================================\n');

  const machineId = 'cvps_unbreakable_test_node_01';
  let agentWs = null;

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Agent Enrollment & Online State
    // ------------------------------------------------------------------------
    console.log('[TEST 1] Testing Agent Initial Enrollment & Online Status...');
    agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
    
    await new Promise((resolve, reject) => {
      agentWs.on('open', () => {
        agentWs.send(JSON.stringify({
          type: 'Auth',
          payload: {
            machine_id: machineId,
            token: 'test_unbreakable_token_123',
            hostname: 'DESKTOP-ZERO-DROP',
            os: 'Windows',
            arch: 'x86_64'
          }
        }));
      });

      agentWs.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AuthAck' && msg.payload.success) {
          resolve(msg);
        }
      });

      agentWs.on('error', reject);
    });

    const m = db.machines.get(machineId);
    assert(m, 'Machine must exist in database');
    assert.strictEqual(m.user_disconnected, false, 'user_disconnected must default to false');
    assert.strictEqual(getMachineStatus(m), 'online', 'Status must be online');
    console.log('  ✅ Agent enrolled successfully: Status is online, user_disconnected is false.');

    // ------------------------------------------------------------------------
    // TEST 2: Zero-Drop Invariant on Abrupt Drop (Grace Period)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing Zero-Drop Protection on Abrupt Connection Drop...');
    agentWs.terminate(); // Abrupt drop simulating network/proxy blip
    await wait(300);

    const mAfterDrop = db.machines.get(machineId);
    assert(mAfterDrop, 'Machine must still exist in database');
    const dropStatus = getMachineStatus(mAfterDrop);
    assert.strictEqual(dropStatus, 'reconnecting', `Machine must enter 'reconnecting' grace state, got: ${dropStatus}`);
    console.log(`  ✅ Zero-Drop Protection confirmed: Machine is not marked offline; status is '${dropStatus}'.`);

    // ------------------------------------------------------------------------
    // TEST 3: Terminal Session Grace Period (No Immediate Destruction)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing Terminal Session Grace Period Buffer...');
    let mockBrowserMsg = null;
    const mockBrowserWs = {
      readyState: WebSocket.OPEN,
      send: (str) => {
        mockBrowserMsg = JSON.parse(str);
      },
      close: () => {}
    };

    const termSessionId = 'term_test_grace_1';
    db.terminalSessions.set(termSessionId, {
      id: termSessionId,
      machine_id: machineId,
      wsBrowser: mockBrowserWs,
      shell_ready: true,
      created_at: Date.now()
    });

    // Simulate another transient drop
    // We create a temporary agent WS and close it to trigger close handler logic
    const tempAgentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
    await new Promise((resolve) => {
      tempAgentWs.on('open', () => {
        tempAgentWs.send(JSON.stringify({
          type: 'Auth',
          payload: {
            machine_id: machineId,
            token: 'test_unbreakable_token_123',
            hostname: 'DESKTOP-ZERO-DROP'
          }
        }));
      });
      tempAgentWs.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AuthAck' && msg.payload.success) resolve();
      });
    });

    // Now close temp agent
    tempAgentWs.close();
    await wait(300);

    assert(db.terminalSessions.has(termSessionId), 'Terminal session must NOT be destroyed on transient drop');
    assert(mockBrowserMsg, 'Browser terminal should receive status update');
    assert.strictEqual(mockBrowserMsg.type, 'status');
    assert.strictEqual(mockBrowserMsg.status, 'reconnecting');
    console.log('  ✅ Terminal Grace Period verified: Session preserved and browser notified of link recovery.');

    // ------------------------------------------------------------------------
    // TEST 4: Command Queuing while Reconnecting
    // ------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing Command Queuing during Reconnecting State...');
    const testCmd = { type: 'TestQueuedCommand', payload: { test_id: 'cmd_123' } };
    const sent = sendServerCommand(machineId, testCmd);
    assert.strictEqual(sent, false, 'sendServerCommand should return false and queue command when agent not connected');
    const queue = db.pendingCommands.get(machineId);
    assert(queue && queue.length > 0, 'Command must be stored in pendingCommands queue');
    assert.strictEqual(queue[0].type, 'TestQueuedCommand');
    console.log('  ✅ Command safely queued in pending buffer while host is reconnecting.');

    // ------------------------------------------------------------------------
    // TEST 5: Agent Reconnect & Seamless Session Resumption
    // ------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing Reconnect, Session Resume & Queue Flush...');
    let receivedQueuedCmd = null;
    let termResumedMsg = null;
    mockBrowserWs.send = (str) => {
      termResumedMsg = JSON.parse(str);
    };

    agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
    await new Promise((resolve, reject) => {
      agentWs.on('open', () => {
        agentWs.send(JSON.stringify({
          type: 'Auth',
          payload: {
            machine_id: machineId,
            token: 'test_unbreakable_token_123',
            hostname: 'DESKTOP-ZERO-DROP'
          }
        }));
      });

      agentWs.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'TestQueuedCommand') {
          receivedQueuedCmd = msg;
          resolve();
        } else if (msg.type === 'AuthAck' && msg.payload.success && !receivedQueuedCmd) {
          // Auth acknowledged; waiting for flushed command
        }
      });
      agentWs.on('error', reject);
    });

    await wait(200);
    assert(receivedQueuedCmd, 'Agent must receive queued command upon reconnection');
    assert.strictEqual(receivedQueuedCmd.payload.test_id, 'cmd_123');
    assert.strictEqual(getMachineStatus(db.machines.get(machineId)), 'online');
    assert(termResumedMsg && termResumedMsg.status === 'connected', 'Browser terminal must be notified of resumption');
    console.log('  ✅ Seamless resumption verified: Queued command delivered and terminal session re-linked.');

    // ------------------------------------------------------------------------
    // TEST 6: Auto-Offline Prevention (Host Never Goes Offline Automatically)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing Immunity to Automatic Offline Timeouts...');
    // Simulate long idle / drop (> 1 hour in the past)
    const longIdleMachine = db.machines.get(machineId);
    longIdleMachine.last_seen = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    agentWs.terminate();
    await wait(300);

    const idleStatus = getMachineStatus(longIdleMachine);
    assert.notStrictEqual(idleStatus, 'offline', 'Enrolled host must NEVER transition to offline automatically without user permission');
    assert.strictEqual(idleStatus, 'reconnecting', 'Enrolled host must remain in persistent reconnecting recovery mode');
    console.log('  ✅ Immunity verified: Enrolled host remains in persistent recovery and never auto-expires.');

    // ------------------------------------------------------------------------
    // TEST 7: Explicit User Disconnect
    // ------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing Explicit User Disconnect via API...');
    // Re-enroll agent first
    agentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
    let disconnectOrderReceived = null;

    await new Promise((resolve) => {
      agentWs.on('open', () => {
        agentWs.send(JSON.stringify({
          type: 'Auth',
          payload: {
            machine_id: machineId,
            token: 'test_unbreakable_token_123',
            hostname: 'DESKTOP-ZERO-DROP'
          }
        }));
      });
      agentWs.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AuthAck' && msg.payload.success) resolve();
        if (msg.type === 'DisconnectOrder') disconnectOrderReceived = msg;
      });
    });

    // Call POST /api/v1/machines/:id/disconnect
    const discRes = await httpRequest('POST', `/api/v1/machines/${machineId}/disconnect`);
    assert.strictEqual(discRes.status, 200);
    assert.strictEqual(discRes.body.success, true);
    assert.strictEqual(discRes.body.status, 'disconnected_by_user');

    await wait(200);
    const mDisconnected = db.machines.get(machineId);
    assert.strictEqual(mDisconnected.user_disconnected, true, 'user_disconnected flag must be set to true');
    assert.strictEqual(getMachineStatus(mDisconnected), 'disconnected_by_user');
    assert(disconnectOrderReceived, 'Agent must receive DisconnectOrder from server');
    console.log('  ✅ Explicit user disconnect verified: Machine status is disconnected_by_user and agent received DisconnectOrder.');

    // Verify subsequent connect attempts while user_disconnected are rejected
    console.log('\n[TEST 8] Verifying Connection Rejected While User Disconnected...');
    const rejectedWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
    let authAckError = null;

    await new Promise((resolve) => {
      rejectedWs.on('open', () => {
        rejectedWs.send(JSON.stringify({
          type: 'Auth',
          payload: {
            machine_id: machineId,
            token: 'test_unbreakable_token_123',
            hostname: 'DESKTOP-ZERO-DROP'
          }
        }));
      });
      rejectedWs.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AuthAck') {
          authAckError = msg.payload.error;
          resolve();
        }
      });
      rejectedWs.on('close', resolve);
    });

    assert(authAckError, 'Server must return AuthAck error for user-disconnected host');
    assert(authAckError.includes('disconnected by user'), `Expected 'disconnected by user' in error, got: ${authAckError}`);
    console.log('  ✅ Connection rejection verified: Host remains parked while user disconnect is active.');

    // ------------------------------------------------------------------------
    // TEST 9: Explicit User Reconnect
    // ------------------------------------------------------------------------
    console.log('\n[TEST 9] Testing Explicit User Reconnect via API...');
    const reconnRes = await httpRequest('POST', `/api/v1/machines/${machineId}/reconnect`);
    assert.strictEqual(reconnRes.status, 200);
    assert.strictEqual(reconnRes.body.success, true);
    assert.strictEqual(reconnRes.body.status, 'reconnecting');

    const mReconnected = db.machines.get(machineId);
    assert.strictEqual(mReconnected.user_disconnected, false, 'user_disconnected flag must be cleared');

    // Agent now reconnects successfully
    const finalAgentWs = new WebSocket(`${WS_URL}/api/v1/relay/connect`);
    let finalAuthSuccess = false;

    await new Promise((resolve, reject) => {
      finalAgentWs.on('open', () => {
        finalAgentWs.send(JSON.stringify({
          type: 'Auth',
          payload: {
            machine_id: machineId,
            token: 'test_unbreakable_token_123',
            hostname: 'DESKTOP-ZERO-DROP'
          }
        }));
      });
      finalAgentWs.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AuthAck' && msg.payload.success) {
          finalAuthSuccess = true;
          resolve();
        }
      });
      finalAgentWs.on('error', reject);
    });

    assert.strictEqual(finalAuthSuccess, true, 'Agent authentication must succeed after user reconnect');
    assert.strictEqual(getMachineStatus(db.machines.get(machineId)), 'online');
    console.log('  ✅ Explicit user reconnect verified: Host connection successfully restored to online.');

    finalAgentWs.close();
    server.close();

    console.log('\n================================================================');
    console.log('🎉 ALL UNBREAKABLE CONNECTION & USER DISCONNECT TESTS PASSED!');
    console.log('================================================================\n');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ TEST FAILURE:', err);
    if (server && server.close) server.close();
    process.exit(1);
  }
}

runTests();
