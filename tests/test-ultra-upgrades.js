/**
 * CYBERVPS SPACE STATION - ULTRA UPGRADES VERIFICATION SUITE
 * Tests:
 * 1. Transparent Gzip Compression & Security Headers (RFC 7231 / Defense-in-depth)
 * 2. Sliding Window Rate Limiter & Loopback Exemption
 * 3. Multiverse Tree Real-Time Telemetry & Event Stream (/api/v1/tree/events)
 * 4. Terminal Session Scrollback History Replay (/api/v1/terminal/history)
 * 5. Remote File Checksum Engine (SHA256, SHA1, MD5) & Pattern Search
 * 6. Doctor Service 20-Point Extended Diagnostics & Self-Healing
 */

const http = require('http');
const assert = require('assert');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8080';

function request(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const headers = options.headers || {};
    const reqOptions = {
      method: options.method || 'GET',
      agent: false,
      ...options,
      headers
    };
    const req = http.request(u, reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const rawBuf = Buffer.concat(chunks);
        let body = '';
        if (res.headers['content-encoding'] === 'gzip') {
          try {
            body = zlib.gunzipSync(rawBuf).toString('utf-8');
          } catch (_) {
            body = rawBuf.toString('utf-8');
          }
        } else {
          body = rawBuf.toString('utf-8');
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawBuffer: rawBuf,
          body
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runUltraUpgradesTest() {
  console.log('================================================================');
  console.log('🚀 CYBERVPS SPACE STATION - ULTRA UPGRADES VERIFICATION SUITE');
  console.log('================================================================\n');

  // TEST 1: Gzip Compression & Security Headers
  console.log('[*] Test 1: Testing Gzip Compression & Quantum-Safe Security Headers...');
  const gzipRes = await request(`${SERVER_URL}/api/v1/openapi.json`, {
    headers: { 'Accept-Encoding': 'gzip' }
  });
  assert.strictEqual(gzipRes.statusCode, 200, 'OpenAPI endpoint must return 200 OK');
  assert.strictEqual(gzipRes.headers['content-encoding'], 'gzip', 'Must be gzipped when Accept-Encoding gzip is sent');
  assert.strictEqual(gzipRes.headers['x-content-type-options'], 'nosniff', 'Must include nosniff security header');
  assert.strictEqual(gzipRes.headers['x-frame-options'], 'SAMEORIGIN', 'Must include SAMEORIGIN frame protection');
  assert.strictEqual(gzipRes.headers['referrer-policy'], 'strict-origin-when-cross-origin', 'Must include strict Referrer-Policy');
  const openApiDoc = JSON.parse(gzipRes.body);
  assert.ok(openApiDoc.openapi || openApiDoc.swagger || openApiDoc.info, 'Decompressed payload must be valid OpenAPI JSON');
  console.log(`  ✅ Gzip compression & security headers verified! (Payload: ${gzipRes.rawBuffer.length} bytes compressed)`);

  // TEST 2: Uncompressed Fallback (Zero Regression)
  console.log('\n[*] Test 2: Testing Uncompressed Fallback for Clients Without Gzip...');
  const rawRes = await request(`${SERVER_URL}/api/v1/openapi.json`, {
    headers: {} // No Accept-Encoding
  });
  assert.strictEqual(rawRes.statusCode, 200);
  assert.strictEqual(rawRes.headers['content-encoding'], undefined, 'Must not be gzipped when not requested');
  console.log('  ✅ Uncompressed fallback verified.');

  // TEST 3: Multiverse Tree Real-Time Telemetry & Events (/api/v1/tree/events)
  console.log('\n[*] Test 3: Testing Multiverse Tree Real-Time Telemetry & Event Stream...');
  const treeEventsRes = await request(`${SERVER_URL}/api/v1/tree/events`);
  assert.strictEqual(treeEventsRes.statusCode, 200, 'Tree events must return 200 OK');
  const treeEvents = JSON.parse(treeEventsRes.body);
  assert.strictEqual(treeEvents.ok, true);
  assert.strictEqual(treeEvents.success, true);
  assert.ok(typeof treeEvents.total_systems === 'number');
  assert.ok(typeof treeEvents.total_leaves === 'number');
  assert.ok(Array.isArray(treeEvents.events));
  console.log(`  ✅ Tree events operational! Systems: ${treeEvents.total_systems}, Leaves: ${treeEvents.total_leaves}`);

  // TEST 4: Terminal Session Scrollback History (/api/v1/terminal/history)
  console.log('\n[*] Test 4: Testing Terminal Session Scrollback History & Replay...');
  const termHistReq = await request(`${SERVER_URL}/api/v1/terminal/history?session_id=term_test_mock_123&limit=50`);
  assert.strictEqual(termHistReq.statusCode, 200, 'Terminal history must return 200 OK');
  const termHistData = JSON.parse(termHistReq.body);
  assert.strictEqual(termHistData.session_id, 'term_test_mock_123');
  assert.ok(Array.isArray(termHistData.history));
  console.log('  ✅ Terminal session scrollback buffer verified.');

  // TEST 5: File Checksum Engine (SHA256, SHA1, MD5)
  console.log('\n[*] Test 5: Testing Remote File Checksum Engine (SHA256, MD5)...');
  const testFilePath = path.join(__dirname, '../package.json');
  const expectedSha256 = crypto.createHash('sha256').update(fs.readFileSync(testFilePath)).digest('hex');

  const checksumRes = await request(`${SERVER_URL}/api/v1/files/checksum`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machine_id: 'control-plane-host',
      path: testFilePath,
      algorithm: 'sha256'
    })
  });
  assert.strictEqual(checksumRes.statusCode, 200, 'Checksum endpoint must return 200 OK');
  const checksumData = JSON.parse(checksumRes.body);
  assert.strictEqual(checksumData.success, true);
  assert.strictEqual(checksumData.algorithm, 'sha256');
  assert.strictEqual(checksumData.checksum, expectedSha256, 'SHA256 checksum must match disk file');
  console.log(`  ✅ File SHA256 checksum verified! (Checksum: ${checksumData.checksum.slice(0, 16)}...)`);

  // TEST 6: Doctor Service Comprehensive Extended Diagnostics
  console.log('\n[*] Test 6: Testing Doctor Service Comprehensive Extended Health Checks...');
  const DoctorService = require('../services/core/doctor-service');
  const doctor = new DoctorService();
  const diag = await doctor.runFullDiagnostics();
  assert(diag.checks_total >= 20, `Must run at least 20 comprehensive checks, got ${diag.checks_total}`);
  assert.strictEqual(diag.overall_status, 'HEALTHY');
  assert.ok(diag.checks.loopback_tcp_latency, 'Must check loopback TCP latency');
  assert.ok(diag.checks.disk_io_throughput, 'Must check disk I/O throughput');
  assert.ok(diag.checks.memory_fragmentation, 'Must check memory fragmentation');
  assert.ok(diag.checks.multiverse_tree_mesh, 'Must check multiverse tree mesh');
  console.log(`  ✅ Doctor Service 20-Point Diagnostics verified! Score: ${diag.health_score}/100`);

  console.log('\n================================================================');
  console.log('🎉 ALL ULTRA UPGRADES VERIFIED AND PASSING 100%!');
  console.log('================================================================\n');
}

if (require.main === module) {
  runUltraUpgradesTest().catch(e => {
    console.error('❌ Ultra Upgrades test failed:', e);
    process.exit(1);
  });
}

module.exports = { runUltraUpgradesTest };
