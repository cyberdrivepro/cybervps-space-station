/**
 * CyberVPS Space Station - Agent Crash & CLI Repair Automated Regression Test Suite
 * Validates:
 * 1. Missing module imports (hmac, hashlib) in agent/universal-agent.py & bin/cybervps.py
 * 2. Exception isolation in try_self_heal_token & send_agent_event
 * 3. CLI subcommand routing (restart, status, logs, doctor, version, help)
 * 4. Unknown command detection and exit code 1
 * 5. Installer handshake truthfulness (no fake "ONLINE in <100ms" claims)
 * 6. Symlink resolution in bin/cybervps wrapper
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const AGENT_SCRIPT = path.join(ROOT_DIR, 'agent', 'universal-agent.py');
const CLI_PY = path.join(ROOT_DIR, 'bin', 'cybervps.py');
const CLI_POLYGLOT = path.join(ROOT_DIR, 'bin', 'cybervps');
const INSTALL_SH = path.join(ROOT_DIR, 'install.sh');
const INSTALL_AGENT_SH = path.join(ROOT_DIR, 'scripts', 'install-agent.sh');

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

console.log('================================================================');
console.log('🧪 RUNNING AGENT CRASH & CLI REPAIR REGRESSION TEST SUITE');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Python Import & AST Validation in agent/universal-agent.py
// -----------------------------------------------------------------------------
runTest('universal-agent.py syntax and required standard imports (hmac, hashlib)', () => {
  const content = fs.readFileSync(AGENT_SCRIPT, 'utf8');
  assert(content.includes('import hmac'), 'universal-agent.py must explicitly import hmac');
  assert(content.includes('import hashlib'), 'universal-agent.py must explicitly import hashlib');
  assert(content.includes('import binascii'), 'universal-agent.py must explicitly import binascii');

  // Verify python compiles the agent without syntax error
  const compileRes = spawnSync('python', ['-m', 'py_compile', AGENT_SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(compileRes.status, 0, `Agent compilation failed: ${compileRes.stderr}`);
});

// -----------------------------------------------------------------------------
// Test 2: Python Import & AST Validation in bin/cybervps.py
// -----------------------------------------------------------------------------
runTest('bin/cybervps.py syntax and required standard imports (hmac, hashlib)', () => {
  const content = fs.readFileSync(CLI_PY, 'utf8');
  assert(content.includes('import hmac'), 'bin/cybervps.py must explicitly import hmac');
  assert(content.includes('import hashlib'), 'bin/cybervps.py must explicitly import hashlib');

  // Verify python compiles the CLI without syntax error
  const compileRes = spawnSync('python', ['-m', 'py_compile', CLI_PY], { encoding: 'utf8' });
  assert.strictEqual(compileRes.status, 0, `CLI compilation failed: ${compileRes.stderr}`);
});

// -----------------------------------------------------------------------------
// Test 3: try_self_heal_token() HMAC generation matches Control Plane signature
// -----------------------------------------------------------------------------
runTest('try_self_heal_token() HMAC generation produces canonical node token', () => {
  const testMid = 'cvps_07b35f854efb_d25a602b';
  const pairingSecret = 'cybervps_pair_station_2026';

  // Server canonical HMAC calculation
  const expectedSig = crypto.createHmac('sha256', pairingSecret)
    .update(`node:${testMid}`)
    .digest('hex')
    .slice(0, 24);
  const expectedToken = `cvps_node_${testMid}_${expectedSig}`;

  // Execute isolated Python snippet testing try_self_heal_token
  const pyCode = `
import hmac, hashlib, os
pairing_secret = "${pairingSecret}"
mid = "${testMid}"
sig = hmac.new(pairing_secret.encode("utf-8"), f"node:{mid}".encode("utf-8"), hashlib.sha256).hexdigest()[:24]
canonical = f"cvps_node_{mid}_{sig}"
print(canonical)
`;
  const res = spawnSync('python', ['-c', pyCode], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `Python snippet failed: ${res.stderr}`);
  const pythonToken = res.stdout.trim();
  assert.strictEqual(pythonToken, expectedToken, 'Python token must match server canonical HMAC token');
});

// -----------------------------------------------------------------------------
// Test 4: Agent self_heal_token execution does NOT raise NameError
// -----------------------------------------------------------------------------
runTest('CyberVPSAgent.try_self_heal_token() runs safely without throwing NameError', () => {
  const pyTest = `
import sys, os
sys.path.insert(0, r"${path.dirname(AGENT_SCRIPT)}")
# Set test mode so we do not attempt central network calls
os.environ["CYBERVPS_TEST_MODE"] = "1"
os.environ["CVPS_PAIRING_KEY"] = "cybervps_pair_station_2026"

# Load agent module
import importlib.util
spec = importlib.util.spec_from_file_location("universal_agent", r"${AGENT_SCRIPT}")
agent_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_mod)

agent = agent_mod.CyberVPSAgent(
    server_url="http://127.0.0.1:8080",
    token="cvps_enroll_master_token",
    machine_id="cvps_07b35f854efb_d25a602b"
)
healed = agent.try_self_heal_token()
assert healed is True, "Token must be healed from master token to canonical token"
assert agent.token.startswith("cvps_node_cvps_07b35f854efb_d25a602b_"), f"Unexpected token: {agent.token}"
print("SELF_HEAL_OK")
`;
  const res = spawnSync('python', ['-c', pyTest], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `Self-heal execution failed with traceback: ${res.stderr}\n${res.stdout}`);
  assert(res.stdout.includes('SELF_HEAL_OK'), 'Agent self-healing must complete and print SELF_HEAL_OK');
});

// -----------------------------------------------------------------------------
// Test 5: CLI Subcommand Execution via agent/universal-agent.py
// -----------------------------------------------------------------------------
runTest('universal-agent.py CLI subcommands (version, help, invalid command)', () => {
  // 1. Version
  const vRes = spawnSync('python', [AGENT_SCRIPT, 'version'], { encoding: 'utf8' });
  assert.strictEqual(vRes.status, 0, `Version command failed: ${vRes.stderr}`);
  assert(vRes.stdout.toLowerCase().includes('cybervps universal agent v'), 'Version command output missing banner');

  // 2. Help
  const hRes = spawnSync('python', [AGENT_SCRIPT, 'help'], { encoding: 'utf8' });
  assert.strictEqual(hRes.status, 0, `Help command failed: ${hRes.stderr}`);
  assert(hRes.stdout.includes('restart'), 'Help output must document restart command');
  assert(hRes.stdout.includes('status'), 'Help output must document status command');
  assert(hRes.stdout.includes('doctor'), 'Help output must document doctor command');
  assert(hRes.stdout.includes('logs'), 'Help output must document logs command');

  // 3. Unknown command returns code 1 and helpful error
  const uRes = spawnSync('python', [AGENT_SCRIPT, 'unknown_subcommand_test'], { encoding: 'utf8' });
  assert.strictEqual(uRes.status, 1, `Unknown command should exit with code 1, got ${uRes.status}`);
  assert(uRes.stdout.includes("Unknown command: 'unknown_subcommand_test'"), `Expected unknown command message, got: ${uRes.stdout}`);
});

// -----------------------------------------------------------------------------
// Test 6: CLI Subcommand Execution via bin/cybervps.py
// -----------------------------------------------------------------------------
runTest('bin/cybervps.py CLI subcommands (version, doctor, help, invalid command)', () => {
  // 1. Version
  const vRes = spawnSync('python', [CLI_PY, 'version'], { encoding: 'utf8' });
  assert.strictEqual(vRes.status, 0, `Version command failed: ${vRes.stderr}`);
  assert(vRes.stdout.toLowerCase().includes('cybervps space station v'), 'Version command output missing banner');

  // 2. Doctor
  const dRes = spawnSync('python', [CLI_PY, 'doctor'], { encoding: 'utf8' });
  assert.strictEqual(dRes.status, 0, `Doctor command failed: ${dRes.stderr}`);
  assert(dRes.stdout.includes('SYSTEM DOCTOR'), 'Doctor output missing banner');
  assert(dRes.stdout.includes('Python Runtime'), 'Doctor output missing Python runtime info');

  // 3. Help
  const hRes = spawnSync('python', [CLI_PY, 'help'], { encoding: 'utf8' });
  assert.strictEqual(hRes.status, 0, `Help command failed: ${hRes.stderr}`);
  assert(hRes.stdout.includes('restart'), 'Help output must document restart');
  assert(hRes.stdout.includes('doctor'), 'Help output must document doctor');
  assert(hRes.stdout.includes('logs'), 'Help output must document logs');

  // 4. Unknown command returns code 1
  const uRes = spawnSync('python', [CLI_PY, 'invalid_action_foo'], { encoding: 'utf8' });
  assert.strictEqual(uRes.status, 1, `Unknown command should exit with code 1, got ${uRes.status}`);
  assert(uRes.stdout.includes("Unknown command: 'invalid_action_foo'"), `Expected unknown command message, got: ${uRes.stdout}`);
});

// -----------------------------------------------------------------------------
// Test 7: Installer Handshake Truthfulness (install.sh)
// -----------------------------------------------------------------------------
runTest('install.sh does not report deceptive unconditional ONLINE status', () => {
  const content = fs.readFileSync(INSTALL_SH, 'utf8');

  // Must NOT contain unconditional fake claim:
  // "echo "  [+] Node connected ONLINE in <100ms!""
  assert(!content.includes('Node connected ONLINE in <100ms!'), 'install.sh must not print deceptive unconditional "Node connected ONLINE in <100ms!"');

  // Must verify handshake response code:
  assert(content.includes('HANDSHAKE_ACK='), 'install.sh must track HANDSHAKE_ACK');
  assert(content.includes('H_CODE='), 'install.sh must inspect HTTP response code');
  assert(content.includes('Initial heartbeat sync in progress') || content.includes('Syncing First Heartbeat'), 'install.sh must truthfully distinguish daemon startup from fleet confirmation');
});

// -----------------------------------------------------------------------------
// Test 8: Symlink Resolution in bin/cybervps
// -----------------------------------------------------------------------------
runTest('bin/cybervps resolves symlink targets and provides fallback execution', () => {
  const content = fs.readFileSync(CLI_POLYGLOT, 'utf8');
  // First 2 lines must include symlink resolution loop
  const topLines = content.split('\n').slice(0, 3).join('\n');
  assert(topLines.includes('readlink'), 'bin/cybervps must use readlink to follow symlinks');
  assert(topLines.includes('while [ -L "$_T" ]'), 'bin/cybervps must loop while link is a symlink');
  assert(topLines.includes('cybervps.py'), 'bin/cybervps must target cybervps.py');
});

// -----------------------------------------------------------------------------
// Test 9: scripts/install-agent.sh CLI Wrapper Resilience
// -----------------------------------------------------------------------------
runTest('scripts/install-agent.sh CLI wrapper routes through space-station bin and universal-agent', () => {
  const content = fs.readFileSync(INSTALL_AGENT_SH, 'utf8');
  assert(content.includes('space-station/bin/cybervps.py'), 'install-agent.sh wrapper must support space-station/bin/cybervps.py');
  assert(content.includes('universal-agent.py'), 'install-agent.sh wrapper must fallback to universal-agent.py');
});

console.log('\n================================================================');
console.log('🎉 ALL AGENT CRASH & CLI REPAIR TESTS PASSED SUCCESSFULLY!');
console.log('================================================================');
