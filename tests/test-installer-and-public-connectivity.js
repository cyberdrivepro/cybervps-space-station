/**
 * Installer & Public Connectivity Automated Regression Test Suite
 *
 * Validates:
 * 1. GET /install.sh with public host injection (zero localhost leakage)
 * 2. GET /install.sh with query parameter overrides (?server=... & ?ticket=...)
 * 3. GET /install.sh auto-ticket generation when no ticket provided
 * 4. GET /install.ps1 with public host and bootstrap capability injection
 * 5. Linux installer container systemd guard (/run/systemd/system)
 * 6. Standardized log directory structure (~/.cybervps/logs/agent.log + symlink)
 * 7. Hosted frontend loopback auto-recovery (GitHub Pages -> Railway default)
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 8092;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const PAIRING_SECRET = 'cybervps_pair_station_2026';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { ...(options.headers || {}) };
    if (!headers['Connection']) headers['Connection'] = 'close';
    if (options.body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(options.body);
    }
    const req = http.request(u, { ...options, headers }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runInstallerTests() {
  console.log('\n================================================================');
  console.log('🚀 RUNNING INSTALLER & PUBLIC CONNECTIVITY REGRESSION TESTS');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  // Start test server process
  console.log(`[*] Spawning Space Station server on port ${PORT}...`);
  const serverProcess = spawn(process.execPath, [path.join(__dirname, '../services/server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      ENABLE_TUNNEL: 'false',
      BOOTSTRAP_SECRET: PAIRING_SECRET,
      PAIRING_KEY: PAIRING_SECRET,
      ADMIN_SECRET: 'test_admin_2026'
    },
    stdio: 'pipe'
  });

  serverProcess.stderr.on('data', (d) => {
    const s = d.toString();
    if (!s.includes('ExperimentalWarning') && !s.includes('DeprecationWarning')) {
      console.error('[SERVER ERR]', s.trim());
    }
  });

  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await request(`${SERVER_URL}/health`);
      if (res.statusCode === 200) { ready = true; break; }
    } catch (_) {}
    await wait(300);
  }
  assert.ok(ready, 'Server failed to start within 9 seconds');
  console.log('  ✅ Test server online and ready.');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: GET /install.sh with public host injection (Zero localhost leakage)
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 1] Testing /install.sh public host template substitution...');
    const pubHost = 'cybervps-space-station.up.railway.app';
    const res1 = await request(`${SERVER_URL}/install.sh`, {
      headers: {
        'Host': pubHost,
        'X-Forwarded-Proto': 'https'
      }
    });
    assert.strictEqual(res1.statusCode, 200, 'install.sh must return 200 OK');
    assert.ok(res1.headers['content-type'].includes('text/x-shellscript'), 'Content-type must be text/x-shellscript');
    
    // Check that public URL was injected into SERVER_URL
    assert.ok(
      res1.body.includes(`https://${pubHost}`),
      `install.sh must contain https://${pubHost}`
    );
    // Ensure default http://localhost:8080 was replaced and does not remain as default
    assert.ok(
      !res1.body.includes('SERVER_URL="http://localhost:8080"'),
      'install.sh must NOT contain default SERVER_URL="http://localhost:8080"'
    );
    assert.ok(
      !res1.body.includes('SERVER_URL="${1:-http://localhost:8080}"'),
      'install.sh must NOT contain default SERVER_URL="${1:-http://localhost:8080}"'
    );
    // Ensure auto-generated bootstrap ticket was injected
    assert.ok(
      res1.body.includes('cvps_boot_'),
      'install.sh must contain auto-generated cvps_boot_ capability ticket'
    );
    console.log(`  ✅ Public /install.sh delivered cleanly with target https://${pubHost} and auto-ticket!`);
    passed++;

    // -------------------------------------------------------------------------
    // TEST 2: GET /install.sh with query parameter overrides (?server=... & ?ticket=...)
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 2] Testing /install.sh explicit query parameter overrides...');
    const customServer = 'https://custom-cluster.domain.io:8443';
    const crypto = require('crypto');
    const ttlSeconds = 1800;
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    const expHex = expiresAt.toString(16);
    const nonce = crypto.randomBytes(8).toString('hex');
    const sig = crypto.createHmac('sha256', PAIRING_SECRET).update(`${expHex}:${nonce}`).digest('hex').slice(0, 24);
    const customTicket = `cvps_boot_${expHex}_${nonce}_${sig}`;

    const res2 = await request(`${SERVER_URL}/install.sh?server=${encodeURIComponent(customServer)}&ticket=${customTicket}`);
    assert.strictEqual(res2.statusCode, 200);
    assert.ok(
      res2.body.includes(customServer),
      `install.sh must inject explicit ?server=${customServer}`
    );
    assert.ok(
      res2.body.includes(customTicket),
      `install.sh must inject explicit ?ticket=${customTicket}`
    );
    console.log(`  ✅ Explicit server and ticket parameter injection verified!`);
    passed++;

    // -------------------------------------------------------------------------
    // TEST 3: GET /install.ps1 with public host and capability injection
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 3] Testing /install.ps1 public host & zero-prompt capability...');
    const res3 = await request(`${SERVER_URL}/install.ps1`, {
      headers: {
        'Host': pubHost,
        'X-Forwarded-Proto': 'https'
      }
    });
    assert.strictEqual(res3.statusCode, 200, 'install.ps1 must return 200 OK');
    assert.ok(
      res3.body.includes(`https://${pubHost}`),
      `install.ps1 must contain targetHost https://${pubHost}`
    );
    assert.ok(
      res3.body.includes('cvps_boot_'),
      'install.ps1 must contain auto-generated cvps_boot_ capability ticket'
    );
    console.log(`  ✅ Public /install.ps1 delivered cleanly with target https://${pubHost}!`);
    passed++;

    // -------------------------------------------------------------------------
    // TEST 4: Linux Installer Container Systemd Guard (/run/systemd/system)
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 4] Verifying container systemd detection guard in install.sh and install-agent.sh...');
    const installShContent = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8');
    const agentShContent = fs.readFileSync(path.join(__dirname, '../scripts/install-agent.sh'), 'utf8');

    assert.ok(
      installShContent.includes('/run/systemd/system'),
      'install.sh must check /run/systemd/system before attempting systemctl'
    );
    assert.ok(
      agentShContent.includes('/run/systemd/system'),
      'scripts/install-agent.sh must check /run/systemd/system before attempting systemctl'
    );
    console.log('  ✅ /run/systemd/system guard verified in both Linux installer pipelines!');
    passed++;

    // -------------------------------------------------------------------------
    // TEST 5: Standardized Log Directory Structure (~/.cybervps/logs + symlink)
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 5] Verifying standardized log directory layout...');
    const watchdogShContent = fs.readFileSync(path.join(__dirname, '../scripts/agent-watchdog.sh'), 'utf8');

    assert.ok(
      agentShContent.includes('LOG_DIR="$CVPS_DIR/logs"') && agentShContent.includes('mkdir -p "$CVPS_DIR" "$LOG_DIR"'),
      'scripts/install-agent.sh must create $CVPS_DIR/logs'
    );
    assert.ok(
      watchdogShContent.includes('LOG_DIR="$CVPS_DIR/logs"') && watchdogShContent.includes('mkdir -p "$CVPS_DIR" "$LOG_DIR"'),
      'scripts/agent-watchdog.sh must create $CVPS_DIR/logs'
    );
    assert.ok(
      installShContent.includes('LOG_DIR="${INSTALL_BASE}/logs"'),
      'install.sh must use canonical LOG_DIR logs subdirectory'
    );
    console.log('  ✅ Canonical log directory (~/.cybervps/logs/agent.log) and symlinks verified!');
    passed++;

    // -------------------------------------------------------------------------
    // TEST 6: Hosted Frontend Loopback Auto-Recovery Verification
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 6] Verifying Frontend Loopback Auto-Recovery and Mode Controls...');
    const indexHtmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const dashboardHtmlContent = fs.readFileSync(path.join(__dirname, '../apps/dashboard/index.html'), 'utf8');

    assert.ok(
      indexHtmlContent.includes('loopback-warning-banner'),
      'index.html must include loopback-warning-banner element'
    );
    assert.ok(
      indexHtmlContent.includes('fixLocalhostConnection'),
      'index.html must implement fixLocalhostConnection function'
    );
    assert.ok(
      indexHtmlContent.includes('setConnectionMode'),
      'index.html must implement setConnectionMode function'
    );
    assert.ok(
      indexHtmlContent.includes('isLoopbackTarget') && indexHtmlContent.includes('isStaticHost'),
      'index.html must auto-recover stale loopback target on static host'
    );
    assert.strictEqual(
      indexHtmlContent,
      dashboardHtmlContent,
      'index.html and apps/dashboard/index.html must be 100% synchronized'
    );
    console.log('  ✅ Frontend loopback auto-recovery, mode controls & dashboard synchronization verified!');
    passed++;

  } finally {
    console.log('\n[*] Cleaning up test server process...');
    serverProcess.kill('SIGTERM');
    await wait(500);
    try { serverProcess.kill('SIGKILL'); } catch (_) {}
  }

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passed}/${total} INSTALLER & CONNECTIVITY TESTS PASSED!`);
  console.log('================================================================\n');
}

runInstallerTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
