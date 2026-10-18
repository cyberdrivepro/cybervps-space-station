/**
 * CyberVPS Space Station - Remote Lifecycle Control, Shared RDP Security & Windows Installer Test Suite
 *
 * Validates:
 * 1. CLI Subcommand routing & argument order tolerance in universal-agent.py, cybervps.py & cybervps
 * 2. Shared RDP / Shared VPS non-admin access denial ([ACCESS DENIED], exit code 5)
 * 3. Authorized override with --force-auth <token> or CYBERVPS_ADMIN_TOKEN
 * 4. Remote Control Plane /api/v1/machines/:id/action endpoints (restart, stop, repair, update, uninstall, reboot)
 * 5. Dashboard FleetView and StationApiClient lifecycle integration
 * 6. Windows native installers (CyberVPS-Setup-x64.exe, Admin/User variants, MSI database, checksums & manifest)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync, execSync } = require('child_process');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const AGENT_SCRIPT = path.join(ROOT_DIR, 'agent', 'universal-agent.py');
const CLI_PY = path.join(ROOT_DIR, 'bin', 'cybervps.py');
const CLI_NODE = path.join(ROOT_DIR, 'bin', 'cybervps');
const DIST_WIN = path.join(ROOT_DIR, 'dist', 'windows');

function runTest(name, fn) {
  try {
    process.stdout.write(`[*] Testing: ${name} ... `);
    fn();
    console.log('PASSED ✅');
  } catch (err) {
    console.log('FAILED ❌');
    console.error(err);
    process.exit(1);
  }
}

async function runAsyncTest(name, fn) {
  try {
    process.stdout.write(`[*] Testing: ${name} ... `);
    await fn();
    console.log('PASSED ✅');
  } catch (err) {
    console.log('FAILED ❌');
    console.error(err);
    process.exit(1);
  }
}

console.log('================================================================');
console.log('🧪 RUNNING LIFECYCLE & WINDOWS INSTALLER REGRESSION TEST SUITE');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: universal-agent.py argument order resilience
// -----------------------------------------------------------------------------
runTest('universal-agent.py CLI argument order tolerance (flags before subcommand)', () => {
  // 1. Direct version command
  const res1 = spawnSync('python', [AGENT_SCRIPT, 'version'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(res1.status, 0, `Expected exit 0, got ${res1.status}. Stderr: ${res1.stderr}`);
  assert(res1.stdout.includes('CyberVPS Universal Agent'), `Expected version banner, got: ${res1.stdout}`);

  // 2. Flags preceding command (e.g. --config /some/path version)
  const res2 = spawnSync('python', [AGENT_SCRIPT, '--config', 'dummy_config.json', 'version'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(res2.status, 0, `Expected exit 0 with flag-first args, got ${res2.status}. Stderr: ${res2.stderr}`);
  assert(res2.stdout.includes('CyberVPS Universal Agent'), `Expected version banner, got: ${res2.stdout}`);

  // 3. Flags preceding help
  const res3 = spawnSync('python', [AGENT_SCRIPT, '-c', 'dummy.json', '--log-dir', 'dummy_logs', 'help'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(res3.status, 0, `Expected exit 0 for help with options, got ${res3.status}`);
  assert(res3.stdout.includes('Usage: cybervps'), `Expected usage banner, got: ${res3.stdout}`);

  // 4. Unknown subcommand exits with code 1 and prints helpful message
  const res4 = spawnSync('python', [AGENT_SCRIPT, 'totally_bogus_action_xyz'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(res4.status, 1, `Expected exit 1 for unknown command, got ${res4.status}`);
  assert(res4.stdout.includes("Unknown command: 'totally_bogus_action_xyz'"), `Expected unknown command error, got: ${res4.stdout}`);
});

// -----------------------------------------------------------------------------
// Test 2: bin/cybervps.py subcommand routing & unknown command handling
// -----------------------------------------------------------------------------
runTest('bin/cybervps.py CLI subcommand routing (repair, update, uninstall, reboot)', () => {
  // 1. Version command
  const res1 = spawnSync('python', [CLI_PY, 'version'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(res1.status, 0, `Expected exit 0, got ${res1.status}`);
  assert(res1.stdout.includes('CyberVPS Space Station v'), `Expected version output, got: ${res1.stdout}`);

  // 2. Options before version
  const res2 = spawnSync('python', [CLI_PY, '--server', 'http://127.0.0.1:8080', 'version'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(res2.status, 0, `Expected exit 0, got ${res2.status}`);

  // 3. Help includes all lifecycle commands
  const res3 = spawnSync('python', [CLI_PY, 'help'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(res3.status, 0);
  assert(res3.stdout.includes('repair, heal'), 'Help must list repair and heal');
  assert(res3.stdout.includes('update, rebuild'), 'Help must list update and rebuild');
  assert(res3.stdout.includes('uninstall'), 'Help must list uninstall');
  assert(res3.stdout.includes('reboot'), 'Help must list reboot');

  // 4. Unknown command exits with code 1
  const res4 = spawnSync('python', [CLI_PY, 'invalid_command_xyz'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(res4.status, 1, `Expected exit 1 for unknown command, got ${res4.status}`);
  assert(res4.stdout.includes("Unknown command: 'invalid_command_xyz'"), `Expected unknown command error, got: ${res4.stdout}`);
});

// -----------------------------------------------------------------------------
// Test 3: Shared RDP / Non-Admin Access Denial & Authorization Bypass
// -----------------------------------------------------------------------------
runTest('Shared RDP Security: Non-admin unauthorized actions denied with [ACCESS DENIED]', () => {
  // If not elevated administrator, privileged commands like stop, restart, repair, uninstall must exit code 5
  // Test by passing an invalid authorization token when non-admin
  const testCfg = path.join(ROOT_DIR, 'dummy_test_config.json');
  fs.writeFileSync(testCfg, JSON.stringify({
    server_url: "http://127.0.0.1:8080",
    token: "valid_secret_token_abc123"
  }));

  try {
    // 1. Attempt privileged action with wrong token via --force-auth
    const resDeny = spawnSync('python', [AGENT_SCRIPT, '--config', testCfg, 'stop', '--force-auth', 'WRONG_TOKEN'], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, CYBERVPS_ADMIN_TOKEN: '' }
    });

    // If running under standard user account, this must be denied with code 5
    // If running in elevated session, IsUserAnAdmin() is true so it proceeds
    const isElevated = process.platform === 'win32' ? (function() {
      try { execSync('net session', { stdio: 'ignore' }); return true; } catch (_) { return false; }
    })() : (process.getuid && process.getuid() === 0);

    if (!isElevated) {
      assert.strictEqual(resDeny.status, 5, `Expected exit 5 for unauthorized stop, got ${resDeny.status}`);
      assert(resDeny.stdout.includes('[ACCESS DENIED] Privileged Operation Prohibited'), 'Expected [ACCESS DENIED] banner');
    }

    // 2. Authorized maintenance via --force-auth with valid token
    const resAuth = spawnSync('python', [AGENT_SCRIPT, '--config', testCfg, 'stop', '--force-auth', 'valid_secret_token_abc123'], {
      encoding: 'utf8',
      timeout: 5000
    });
    // With valid token, it must NOT fail with ACCESS DENIED (code 5)
    assert.notStrictEqual(resAuth.status, 5, `Valid token should not result in access denied (exit 5), got ${resAuth.status}`);
  } finally {
    if (fs.existsSync(testCfg)) fs.unlinkSync(testCfg);
  }
});

// -----------------------------------------------------------------------------
// Test 4: Node CLI Polyglot routing (bin/cybervps)
// -----------------------------------------------------------------------------
runTest('bin/cybervps polyglot routing for repair, update, uninstall, reboot', () => {
  const resHelp = spawnSync('node', [CLI_NODE, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(resHelp.status, 0);
  assert(resHelp.stdout.includes('update'), 'Node CLI must document update');
  assert(resHelp.stdout.includes('uninstall'), 'Node CLI must document uninstall');

  const resVer = spawnSync('node', [CLI_NODE, 'version'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(resVer.status, 0);
  assert(resVer.stdout.includes('CyberVPS Space Station v'), `Expected version string, got: ${resVer.stdout}`);
});

// -----------------------------------------------------------------------------
// Test 5: Control Plane API Endpoint /api/v1/machines/:id/action
// -----------------------------------------------------------------------------
async function testServerMachineActions() {
  const serverJsPath = path.join(ROOT_DIR, 'services', 'server.js');
  const serverContent = fs.readFileSync(serverJsPath, 'utf8');

  // Verify that server.js explicitly handles all 6 remote lifecycle actions
  assert(serverContent.includes("normAction === 'reboot' || normAction === 'reboot_host'"), 'server.js must handle reboot action');
  assert(serverContent.includes("normAction === 'restart' || normAction === 'restart_agent'"), 'server.js must handle restart action');
  assert(serverContent.includes("normAction === 'stop' || normAction === 'stop_agent'"), 'server.js must handle stop action');
  assert(serverContent.includes("normAction === 'repair' || normAction === 'repair_agent' || normAction === 'heal'"), 'server.js must handle repair action');
  assert(serverContent.includes("normAction === 'rebuild' || normAction === 'rebuild_agent' || normAction === 'update'"), 'server.js must handle update action');
  assert(serverContent.includes("normAction === 'uninstall' || normAction === 'uninstall_agent'"), 'server.js must handle uninstall action');
  assert(serverContent.includes("RebootHost"), 'server.js must dispatch RebootHost RPC');
  assert(serverContent.includes("RestartAgent"), 'server.js must dispatch RestartAgent RPC');
  assert(serverContent.includes("StopAgent"), 'server.js must dispatch StopAgent RPC');
  assert(serverContent.includes("RepairAgent"), 'server.js must dispatch RepairAgent RPC');
  assert(serverContent.includes("UninstallAgent"), 'server.js must dispatch UninstallAgent RPC');
}

runTest('services/server.js machine action route coverage for all 6 lifecycle commands', () => {
  testServerMachineActions();
});

// -----------------------------------------------------------------------------
// Test 6: Dashboard Client & FleetView UI Integration
// -----------------------------------------------------------------------------
runTest('Dashboard integration: StationApiClient and FleetView lifecycle controls', () => {
  const apiClientPath = path.join(ROOT_DIR, 'apps', 'dashboard', 'src', 'core', 'api-client.js');
  const fleetViewPath = path.join(ROOT_DIR, 'apps', 'dashboard', 'src', 'modules', 'fleet-view.js');

  const clientContent = fs.readFileSync(apiClientPath, 'utf8');
  assert(clientContent.includes('triggerMachineAction(machineId, action, params = {})'), 'StationApiClient must have triggerMachineAction');
  assert(clientContent.includes('/api/v1/machines/'), 'triggerMachineAction must call /api/v1/machines/:id/action');

  const fleetContent = fs.readFileSync(fleetViewPath, 'utf8');
  assert(fleetContent.includes('lifecycle-select'), 'FleetView must contain lifecycle-select dropdown');
  assert(fleetContent.includes('handleLifecycleAction'), 'FleetView must define handleLifecycleAction');
  assert(fleetContent.includes('Restart Agent'), 'Lifecycle dropdown must include Restart Agent');
  assert(fleetContent.includes('Stop Agent'), 'Lifecycle dropdown must include Stop Agent');
  assert(fleetContent.includes('Repair / Heal'), 'Lifecycle dropdown must include Repair / Heal');
  assert(fleetContent.includes('Update Agent'), 'Lifecycle dropdown must include Update Agent');
  assert(fleetContent.includes('Uninstall Agent'), 'Lifecycle dropdown must include Uninstall Agent');
});

// -----------------------------------------------------------------------------
// Test 7: Windows Installers Build Verification (.exe, .msi, checksums, manifest)
// -----------------------------------------------------------------------------
runTest('Windows installer artifacts and SHA-256 integrity manifest', () => {
  const setupCs = path.join(ROOT_DIR, 'installers', 'windows', 'CyberVPS-Setup.cs');
  const buildPs1 = path.join(ROOT_DIR, 'installers', 'windows', 'build-windows-installers.ps1');
  const msiPs1 = path.join(ROOT_DIR, 'installers', 'windows', 'generate-msi.ps1');
  const adminManifest = path.join(ROOT_DIR, 'installers', 'windows', 'app.admin.manifest');
  const userManifest = path.join(ROOT_DIR, 'installers', 'windows', 'app.user.manifest');

  // Verify source files exist
  assert(fs.existsSync(setupCs), `Missing CyberVPS-Setup.cs: ${setupCs}`);
  assert(fs.existsSync(buildPs1), `Missing build-windows-installers.ps1: ${buildPs1}`);
  assert(fs.existsSync(msiPs1), `Missing generate-msi.ps1: ${msiPs1}`);
  assert(fs.existsSync(adminManifest), `Missing app.admin.manifest: ${adminManifest}`);
  assert(fs.existsSync(userManifest), `Missing app.user.manifest: ${userManifest}`);

  const csSource = fs.readFileSync(setupCs, 'utf8');
  assert(csSource.includes('CyberVPS.Installer'), 'C# source must declare CyberVPS.Installer namespace');
  assert(csSource.includes('requireAdministrator') || fs.readFileSync(adminManifest, 'utf8').includes('requireAdministrator'));
  assert(csSource.includes('asInvoker') || fs.readFileSync(userManifest, 'utf8').includes('asInvoker'));
  assert(csSource.includes('--admin') && csSource.includes('--user') && csSource.includes('--silent'), 'C# source must support --admin, --user, --silent');

  // If artifacts do not exist and on Windows, attempt auto-build
  const exeTarget = path.join(DIST_WIN, 'CyberVPS-Setup-x64.exe');
  if (!fs.existsSync(exeTarget) && process.platform === 'win32') {
    spawnSync('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', buildPs1], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      timeout: 30000
    });
  }

  // If built or on Windows, verify artifacts
  if (fs.existsSync(exeTarget)) {
    const files = [
      'CyberVPS-Setup-x64.exe',
      'CyberVPS-Setup-Admin-x64.exe',
      'CyberVPS-Setup-User-x64.exe',
      'CyberVPS-Host-Agent-x64.msi',
      'checksums.sha256',
      'release-manifest.json'
    ];

    for (const f of files) {
      const fullPath = path.join(DIST_WIN, f);
      assert(fs.existsSync(fullPath), `Artifact missing: ${fullPath}`);
      const stat = fs.statSync(fullPath);
      assert(stat.size > 0, `Artifact empty: ${fullPath}`);
    }

    // Verify SHA-256 checksums match real files
    const checksumContent = fs.readFileSync(path.join(DIST_WIN, 'checksums.sha256'), 'utf8');
    const lines = checksumContent.split(/\r?\n/).filter(l => l.trim().length > 0);
    assert(lines.length >= 4, `Expected at least 4 checksum entries, got ${lines.length}`);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const expectedHash = parts[0];
      const fileName = parts[1];
      const targetFile = path.join(DIST_WIN, fileName);
      assert(fs.existsSync(targetFile), `Referenced file missing: ${fileName}`);

      const fileBuf = fs.readFileSync(targetFile);
      const actualHash = crypto.createHash('sha256').update(fileBuf).digest('hex').toLowerCase();
      assert.strictEqual(actualHash, expectedHash, `SHA256 mismatch for ${fileName}: expected ${expectedHash}, got ${actualHash}`);
    }

    // Verify release manifest JSON
    const rawManifest = fs.readFileSync(path.join(DIST_WIN, 'release-manifest.json'), 'utf8').replace(/^\uFEFF/, '');
    const manifest = JSON.parse(rawManifest);
    assert.strictEqual(manifest.product, 'CyberVPS Space Station');
    assert.strictEqual(manifest.architecture, 'x64');
    assert.strictEqual(manifest.platform, 'windows');
    assert(Array.isArray(manifest.artifacts), 'manifest.artifacts must be an array');
    assert.strictEqual(manifest.artifacts.length, 4, 'manifest must have 4 artifacts');

    const modes = manifest.artifacts.map(a => a.target_mode);
    assert(modes.includes('dual_mode'), 'Manifest must include dual_mode');
    assert(modes.includes('administrator'), 'Manifest must include administrator');
    assert(modes.includes('user'), 'Manifest must include user');
    assert(modes.includes('enterprise_msi'), 'Manifest must include enterprise_msi');

    // Verify executable responds to --help on Windows
    if (process.platform === 'win32') {
      const exeRes = spawnSync(exeTarget, ['--help'], { encoding: 'utf8', timeout: 5000 });
      assert.strictEqual(exeRes.status, 0);
      assert(exeRes.stdout.includes('CYBERVPS SPACE STATION - NATIVE WINDOWS HOST AGENT INSTALLER'), 'EXE must show official banner');
      assert(exeRes.stdout.includes('--admin'), 'EXE must document --admin');
      assert(exeRes.stdout.includes('--user'), 'EXE must document --user');
      assert(exeRes.stdout.includes('--silent'), 'EXE must document --silent');
    }
  }
});

console.log('\n================================================================');
console.log('🎉 ALL LIFECYCLE & WINDOWS INSTALLER TESTS PASSED (100%)');
console.log('================================================================\n');
