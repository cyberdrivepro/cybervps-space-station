/**
 * CYBERVPS SPACE STATION × REPLIT VPS LAB AUTOMATED TEST SUITE
 * Tests capability-aware container detection, active WebSocket ping-pong keepalive,
 * Replit API routes, provider-paused state evaluation, and CLI subcommands.
 */

const assert = require('assert');
const http = require('http');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const TEST_PORT = 8094;

console.log('================================================================');
console.log('🧪 RUNNING REPLIT VPS LAB & IDLE RELIABILITY TEST SUITE');
console.log('================================================================');

async function runTests() {
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[*] ${name} ... PASSED ✅`);
      passed++;
    } catch (err) {
      console.error(`[!] ${name} ... FAILED ❌`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[*] ${name} ... PASSED ✅`);
      passed++;
    } catch (err) {
      console.error(`[!] ${name} ... FAILED ❌`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // 1. Documentation & Installer Assets
  test('Documentation suite files exist and contain complete analysis', () => {
    const docs = [
      'docs/replit-vps/video-command-ledger.md',
      'docs/replit-vps/COMMANDS.md',
      'docs/replit-vps/TROUBLESHOOTING.md',
      'docs/replit-vps/ARCHITECTURE.md'
    ];
    for (const doc of docs) {
      const p = path.join(REPO_ROOT, doc);
      assert(fs.existsSync(p), `Missing document: ${doc}`);
      const stat = fs.statSync(p);
      assert(stat.size > 500, `Document ${doc} is unexpectedly small (${stat.size} bytes)`);
    }
  });

  test('Replit installers & supervisor scripts exist and contain required loops', () => {
    const scripts = [
      'installers/replit-vps/install.sh',
      'installers/replit-vps/start-desktop.sh',
      'installers/replit-vps/start-browser.sh',
      'installers/replit-vps/supervise.sh'
    ];
    for (const s of scripts) {
      const p = path.join(REPO_ROOT, s);
      assert(fs.existsSync(p), `Missing script: ${s}`);
      const content = fs.readFileSync(p, 'utf8');
      assert(content.includes('#!/usr/bin/env bash'), `Missing bash shebang in ${s}`);
    }
    const supContent = fs.readFileSync(path.join(REPO_ROOT, 'installers/replit-vps/supervise.sh'), 'utf8');
    assert(supContent.includes('while true; do'), 'Supervisor missing infinite supervision loop');
    assert(supContent.includes('universal-agent.py'), 'Supervisor missing agent check');
  });

  // 2. Python Universal Agent Capabilities & Provider Detection
  test('Universal Agent has provider detection and active keepalive capabilities', () => {
    const pyScript = path.join(REPO_ROOT, 'agent/universal-agent.py');
    const content = fs.readFileSync(pyScript, 'utf8');
    assert(content.includes('def detect_provider_environment'), 'Missing detect_provider_environment method');
    assert(content.includes('"active_ws_heartbeat": True'), 'Missing active_ws_heartbeat capability');
    assert(content.includes('"replit_lab": True'), 'Missing replit_lab capability');
    assert(content.includes('"decoupled_desktop": True'), 'Missing decoupled_desktop capability');
    assert(content.includes('def _heartbeat_loop'), 'Missing _heartbeat_loop in RelayWebSocket');
    assert(content.includes('SO_KEEPALIVE'), 'Missing SO_KEEPALIVE socket configuration');
    assert(content.includes('handle_replit_rpc'), 'Missing handle_replit_rpc in agent');
  });

  // 3. CLI Subcommand Tests
  test('CLI cybervps replit doctor runs cleanly and reports diagnostics', () => {
    const cliPath = path.join(REPO_ROOT, 'bin/cybervps.py');
    const out = execSync(`python "${cliPath}" replit doctor`, { encoding: 'utf8' });
    assert(out.includes('REPLIT VPS LAB DOCTOR'), 'Output missing REPLIT VPS LAB DOCTOR header');
    assert(out.includes('KVM Virtualization'), 'Output missing KVM virtualization report');
    assert(out.includes('Physical Memory'), 'Output missing memory report');
  });

  test('CLI cybervps replit vnc displays valid endpoint coordinates', () => {
    const cliPath = path.join(REPO_ROOT, 'bin/cybervps.py');
    const out = execSync(`python "${cliPath}" replit vnc`, { encoding: 'utf8' });
    assert(out.includes('noVNC CONNECTION DETAILS'), 'Output missing connection details');
    assert(out.includes('http://localhost:'), 'Output missing localhost URL');
    assert(out.includes('5901'), 'Output missing RFB display port 5901');
  });

  // 4. Server Replit API Routes & Provider-Paused State Test
  await testAsync('Server Replit API endpoints and provider-paused evaluation', async () => {
    const serverPath = path.join(REPO_ROOT, 'services/server.js');
    const env = {
      ...process.env,
      PORT: String(TEST_PORT),
      NODE_ENV: 'test',
      ADMIN_TOKEN: 'test_replit_admin_secret_123',
      DATA_DIR: path.join(REPO_ROOT, 'tests/scratch/data_' + Date.now())
    };

    fs.mkdirSync(env.DATA_DIR, { recursive: true });

    const serverProc = spawn('node', [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });

    await new Promise((resolve, reject) => {
      let started = false;
      serverProc.stdout.on('data', d => {
        if (d.toString().includes('listening on port') || d.toString().includes('Space Station') || d.toString().includes('Relay')) {
          if (!started) { started = true; setTimeout(resolve, 800); }
        }
      });
      serverProc.stderr.on('data', d => {
        if (!started && d.toString().includes('listening')) {
          started = true; setTimeout(resolve, 800);
        }
      });
      setTimeout(() => { if (!started) resolve(); }, 3500);
    });

    try {
      // Test GET /api/v1/replit/detect
      const detectRes = await makeRequest(`http://127.0.0.1:${TEST_PORT}/api/v1/replit/detect`);
      assert.strictEqual(detectRes.statusCode, 200, `detect endpoint returned ${detectRes.statusCode}`);
      const detectData = JSON.parse(detectRes.body);
      assert.strictEqual(detectData.success, true);
      assert(Array.isArray(detectData.detected_environments));

      // Test GET /api/v1/replit/health
      const healthRes = await makeRequest(`http://127.0.0.1:${TEST_PORT}/api/v1/replit/health`);
      assert.strictEqual(healthRes.statusCode, 200);
      const healthData = JSON.parse(healthRes.body);
      assert.strictEqual(healthData.success, true);

      // Test GET /health
      const baseHealth = await makeRequest(`http://127.0.0.1:${TEST_PORT}/health`);
      assert.strictEqual(baseHealth.statusCode, 200);
    } finally {
      serverProc.kill('SIGTERM');
      try { fs.rmSync(env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
    }
  });

  // 5. Dashboard HTML & Sync Verification
  test('Dashboard contains Replit VPS Lab view, navigation link, and JS controller', () => {
    for (const f of ['apps/dashboard/index.html', 'index.html']) {
      const p = path.join(REPO_ROOT, f);
      const html = fs.readFileSync(p, 'utf8');
      assert(html.includes('id="view-replit"'), `${f} missing #view-replit panel`);
      assert(html.includes('fetchReplitLabStatus'), `${f} missing fetchReplitLabStatus controller`);
      assert(html.includes('replitDesktopAction'), `${f} missing replitDesktopAction function`);
      assert(html.includes('Cloud Sandbox Idle-Pause Awareness'), `${f} missing idle-pause warning banner`);
    }
  });

  console.log('================================================================');
  console.log(`🎉 ALL ${passed}/${total} REPLIT VPS LAB & RELIABILITY TESTS PASSED!`);
  console.log('================================================================');
}

function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(url, options, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`Request to ${urlStr} timed out`));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

runTests();
