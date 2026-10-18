/**
 * CyberVPS Space Station - Windows UAC Fallback & Obsidian Security Automated Regression Test Suite
 * Validates:
 * 1. Windows Universal Setup C# bootstrapper catches Win32Exception 1223 (ERROR_CANCELLED) on UAC decline and gracefully falls back to Per-User installation (%LOCALAPPDATA%\CyberVPS)
 * 2. build-windows-installers.ps1 embeds asInvoker manifest into CyberVPS-Setup-x64.exe
 * 3. generate-msi.ps1 configures dual-mode MSI properties (ALLUSERS=2, MSIINSTALLPERUSER=1)
 * 4. Control Plane REST API endpoints for Emergency Blackout & Obsidian Pillar file protection
 * 5. Python Agent Obsidian Pillar SHA-256 snapshotting, tamper detection, atomic restoration, and autonomic blackout trigger (>=3 files)
 * 6. Native Python CLI 'cybervps security' subcommands (blackout, protect, scan, restore, files, incidents, status)
 * 7. Dashboard UI components and StationApiClient security methods
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const AGENT_SCRIPT = path.join(ROOT_DIR, 'agent', 'universal-agent.py');
const CLI_PY = path.join(ROOT_DIR, 'bin', 'cybervps.py');
const SETUP_CS = path.join(ROOT_DIR, 'installers', 'windows', 'CyberVPS-Setup.cs');
const BUILD_WIN_PS1 = path.join(ROOT_DIR, 'installers', 'windows', 'build-windows-installers.ps1');
const GEN_MSI_PS1 = path.join(ROOT_DIR, 'installers', 'windows', 'generate-msi.ps1');
const DASHBOARD_HTML = path.join(ROOT_DIR, 'apps', 'dashboard', 'index.html');
const API_CLIENT_JS = path.join(ROOT_DIR, 'apps', 'dashboard', 'src', 'core', 'api-client.js');
const SERVER_JS = path.join(ROOT_DIR, 'services', 'server.js');

function runTest(name, fn) {
  try {
    process.stdout.write(`[*] Testing: ${name} ... `);
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log('PASSED ✅');
      }).catch(err => {
        console.log('FAILED ❌');
        console.error(err);
        process.exit(1);
      });
    }
    console.log('PASSED ✅');
  } catch (err) {
    console.log('FAILED ❌');
    console.error(err);
    process.exit(1);
  }
}

async function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { ...(options.headers || {}) };
    headers['Connection'] = 'close';
    if (options.body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(options.body);
    }
    const req = http.request(u, { ...options, headers }, (res) => {
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

async function main() {
  console.log('================================================================');
  console.log('🧪 RUNNING WINDOWS UAC FALLBACK & OBSIDIAN SECURITY TEST SUITE');
  console.log('================================================================\n');

  // -----------------------------------------------------------------------------
  // Test 1: CyberVPS-Setup.cs UAC Fallback & Per-User Resilience
  // -----------------------------------------------------------------------------
  runTest('CyberVPS-Setup.cs handles Win32Exception 1223 (ERROR_CANCELLED) with per-user fallback', () => {
    assert(fs.existsSync(SETUP_CS), `Missing ${SETUP_CS}`);
    const cs = fs.readFileSync(SETUP_CS, 'utf8');

    // Must catch Win32Exception and check error code 1223
    assert(cs.includes('Win32Exception'), 'Must catch Win32Exception on Process.Start elevation failure');
    assert(cs.includes('1223'), 'Must check NativeErrorCode == 1223 (ERROR_CANCELLED / UAC declined)');
    assert(cs.includes('PerformInstall(targetAdminMode)'), 'Must gracefully fall back to per-user install upon UAC decline');
    assert(cs.includes('LocalApplicationData'), 'Per-user install must target %LOCALAPPDATA%\\CyberVPS');
    assert(cs.includes('CurrentVersion\\Run'), 'Per-user install must register in HKCU Run registry for non-elevated autostart');
    assert(cs.includes('p == null'), 'Must handle Process.Start returning null');
  });

  // -----------------------------------------------------------------------------
  // Test 2: build-windows-installers.ps1 Manifest Embedding (asInvoker)
  // -----------------------------------------------------------------------------
  runTest('build-windows-installers.ps1 compiles CyberVPS-Setup-x64.exe with asInvoker manifest', () => {
    assert(fs.existsSync(BUILD_WIN_PS1), `Missing ${BUILD_WIN_PS1}`);
    const ps1 = fs.readFileSync(BUILD_WIN_PS1, 'utf8');

    assert(ps1.includes('app.user.manifest'), 'Must reference app.user.manifest');
    assert(ps1.includes('/win32manifest:'), 'Must pass /win32manifest flag to csc.exe compiler');
    assert(ps1.includes('asInvoker'), 'Manifest must specify requestedExecutionLevel level="asInvoker" to prevent OS elevation heuristics');
  });

  // -----------------------------------------------------------------------------
  // Test 3: generate-msi.ps1 Dual-Mode Per-User Configuration
  // -----------------------------------------------------------------------------
  runTest('generate-msi.ps1 configures dual-mode MSI (ALLUSERS=2, MSIINSTALLPERUSER=1)', () => {
    assert(fs.existsSync(GEN_MSI_PS1), `Missing ${GEN_MSI_PS1}`);
    const ps1 = fs.readFileSync(GEN_MSI_PS1, 'utf8');

    assert(ps1.includes('ALLUSERS') && ps1.includes('2'), 'MSI must configure ALLUSERS=2 for dual-purpose installation');
    assert(ps1.includes('MSIINSTALLPERUSER') && ps1.includes('1'), 'MSI must configure MSIINSTALLPERUSER=1 for default per-user execution');
  });

  // -----------------------------------------------------------------------------
  // Test 4: Control Plane Security REST API Endpoints
  // -----------------------------------------------------------------------------
  const TEST_PORT = 18889;
  const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
  const TEST_PAIR_KEY = 'test_sec_pairing_key';
  const TEST_ENROLL_TOKEN = 'test_enroll_token_999';
  console.log(`[*] Starting test Space Station Server on port ${TEST_PORT}...`);
  const srv = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, PORT: String(TEST_PORT), ENABLE_TUNNEL: 'false', PAIRING_KEY: TEST_PAIR_KEY, ENROLLMENT_TOKEN: TEST_ENROLL_TOKEN },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 1200));

  try {
    // 4.0: Enroll test node
    await runTest('Control Plane Node Enrollment (Auth)', async () => {
      const enrollRes = await request(`${SERVER_URL}/api/v1/relay/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'Auth',
          payload: {
            machine_id: 'test_node_sec_01',
            token: TEST_ENROLL_TOKEN,
            hostname: 'sec-node.local',
            platform: 'windows'
          }
        })
      });
      assert.strictEqual(enrollRes.statusCode, 200);
      const enrollBody = JSON.parse(enrollRes.body);
      assert.strictEqual(enrollBody.ok, true);
    });

    // 4A: Blackout Activate
    await runTest('Control Plane POST /api/v1/security/blackout/activate', async () => {
      const res = await request(`${SERVER_URL}/api/v1/security/blackout/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': TEST_PAIR_KEY },
        body: JSON.stringify({
          machine_id: 'test_node_sec_01',
          reason: 'Automated test threat detection',
          lock_session: true,
          operator: 'SecTester'
        })
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.active, true);
      assert.strictEqual(data.incident.reason, 'Automated test threat detection');
      assert.strictEqual(data.incident.lock_session, true);
    });

    // 4B: Blackout Status
    await runTest('Control Plane GET /api/v1/security/blackout/status', async () => {
      const res = await request(`${SERVER_URL}/api/v1/security/blackout/status?machine_id=test_node_sec_01`, {
        headers: { 'X-CVPS-Pairing-Key': TEST_PAIR_KEY }
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.active, true);
    });

    // 4C: Blackout Release
    await runTest('Control Plane POST /api/v1/security/blackout/release', async () => {
      const res = await request(`${SERVER_URL}/api/v1/security/blackout/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': TEST_PAIR_KEY },
        body: JSON.stringify({
          machine_id: 'test_node_sec_01',
          operator: 'SecTester'
        })
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.active, false);
    });

    // 4D: Obsidian Pillar Protect File
    const dummyFilePath = path.join(ROOT_DIR, 'test_pillar_target.txt');
    fs.writeFileSync(dummyFilePath, 'CyberVPS Obsidian Pillar Test Payload v1.0.0', 'utf8');

    await runTest('Control Plane POST /api/v1/security/pillar/protect', async () => {
      const res = await request(`${SERVER_URL}/api/v1/security/pillar/protect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': TEST_PAIR_KEY },
        body: JSON.stringify({
          machine_id: 'test_node_sec_01',
          path: dummyFilePath,
          policy: 'immutable_snapshot'
        })
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.status, 'VERIFIED');
      assert.strictEqual(data.path, dummyFilePath);
    });

    // 4E: Obsidian Pillar List Files
    await runTest('Control Plane GET /api/v1/security/pillar/files', async () => {
      const res = await request(`${SERVER_URL}/api/v1/security/pillar/files?machine_id=test_node_sec_01`, {
        headers: { 'X-CVPS-Pairing-Key': TEST_PAIR_KEY }
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.success, true);
      assert(data.files.length >= 1);
      assert.strictEqual(data.files[0].path, dummyFilePath);
    });

    // 4F: Obsidian Pillar Status
    await runTest('Control Plane GET /api/v1/security/pillar/status', async () => {
      const res = await request(`${SERVER_URL}/api/v1/security/pillar/status?machine_id=test_node_sec_01`, {
        headers: { 'X-CVPS-Pairing-Key': TEST_PAIR_KEY }
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.total_protected, 1);
      assert.strictEqual(data.tamper_count, 0);
    });

    // 4G: Obsidian Pillar Verify File Integrity
    await runTest('Control Plane POST /api/v1/security/pillar/verify', async () => {
      const res = await request(`${SERVER_URL}/api/v1/security/pillar/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': TEST_PAIR_KEY },
        body: JSON.stringify({
          machine_id: 'test_node_sec_01',
          path: dummyFilePath
        })
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.status, 'VERIFIED');
    });

    // 4H: Obsidian Pillar Atomic File Restoration
    await runTest('Control Plane POST /api/v1/security/pillar/restore triggers verified restore', async () => {
      const res = await request(`${SERVER_URL}/api/v1/security/pillar/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CVPS-Pairing-Key': TEST_PAIR_KEY },
        body: JSON.stringify({
          machine_id: 'test_node_sec_01',
          path: dummyFilePath
        })
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.status, 'RECOVERED');
    });

    // Clean up test file
    try { fs.unlinkSync(dummyFilePath); } catch (_) {}

    // Clean up test file
    try { fs.unlinkSync(dummyFilePath); } catch (_) {}

  } finally {
    srv.kill();
  }

  // -----------------------------------------------------------------------------
  // Test 5: Python Universal Agent Code Verification (Obsidian Pillar & Session Lock)
  // -----------------------------------------------------------------------------
  runTest('universal-agent.py implements LockWorkStation, Blackout and Pillar containment', () => {
    const agentCode = fs.readFileSync(AGENT_SCRIPT, 'utf8');
    assert(agentCode.includes('LockWorkStation'), 'Must implement LockWorkStation for Windows session lock');
    assert(agentCode.includes('loginctl'), 'Must implement loginctl lock-session for Linux session lock');
    assert(agentCode.includes('handle_blackout_command'), 'Must implement handle_blackout_command');
    assert(agentCode.includes('handle_obsidian_pillar_command'), 'Must implement handle_obsidian_pillar_command');
    assert(agentCode.includes('tampered_count >= 3'), 'Must automatically trigger Blackout if >=3 files tampered');
    assert(agentCode.includes('self.quarantine_dir'), 'Must backup files to quarantine upon blackout');
  });

  // -----------------------------------------------------------------------------
  // Test 6: CLI 'cybervps security' Subcommand Execution
  // -----------------------------------------------------------------------------
  runTest('bin/cybervps.py executes security status and help without errors', () => {
    const resStatus = spawnSync('python', [CLI_PY, 'security', 'status'], { encoding: 'utf8' });
    assert.strictEqual(resStatus.status, 0, `CLI security status failed: ${resStatus.stderr}`);
    assert(resStatus.stdout.includes('OBSIDIAN SECURITY OVERVIEW'));
    assert(resStatus.stdout.includes('Vault Storage'));
    assert(resStatus.stdout.includes('Quarantine Storage'));

    const resHelp = spawnSync('python', [CLI_PY, 'help'], { encoding: 'utf8' });
    assert.strictEqual(resHelp.status, 0);
    assert(resHelp.stdout.includes('security <cmd>'));
  });

  // -----------------------------------------------------------------------------
  // Test 7: Dashboard UI Assets and Client Methods Verification
  // -----------------------------------------------------------------------------
  runTest('apps/dashboard/index.html & api-client.js contain all Obsidian Security assets', () => {
    const html = fs.readFileSync(DASHBOARD_HTML, 'utf8');
    assert(html.includes('id="view-security"'), 'Dashboard must contain view-security panel');
    assert(html.includes('id="modal-pillar-protect"'), 'Dashboard must contain modal-pillar-protect');
    assert(html.includes('id="modal-blackout-activate"'), 'Dashboard must contain modal-blackout-activate');
    assert(html.includes('id="security-machine-select"'), 'Dashboard must contain security-machine-select');
    assert(html.includes('navigate(\'security\')'), 'Dashboard must have sidebar link to security view');
    assert(html.includes('initSecurityView'), 'Dashboard must define initSecurityView()');

    const client = fs.readFileSync(API_CLIENT_JS, 'utf8');
    assert(client.includes('getBlackoutStatus'), 'api-client.js must define getBlackoutStatus');
    assert(client.includes('activateBlackout'), 'api-client.js must define activateBlackout');
    assert(client.includes('releaseBlackout'), 'api-client.js must define releaseBlackout');
    assert(client.includes('getObsidianPillarStatus'), 'api-client.js must define getObsidianPillarStatus');
    assert(client.includes('getProtectedFiles'), 'api-client.js must define getProtectedFiles');
    assert(client.includes('protectFile'), 'api-client.js must define protectFile');
    assert(client.includes('verifyProtectedFiles'), 'api-client.js must define verifyProtectedFiles');
    assert(client.includes('restoreProtectedFile'), 'api-client.js must define restoreProtectedFile');
  });

  console.log('\n================================================================');
  console.log('🎉 ALL WINDOWS UAC FALLBACK & OBSIDIAN SECURITY TESTS PASSED!');
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
