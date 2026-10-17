/**
 * CYBERVPS SPACE STATION - OPENAPI CONTRACT & SCHEMA VALIDATOR TEST
 * Validates OpenAPI 3.1 specification, SchemaValidator, and AuthGuard role boundaries
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SchemaValidator = require('../api/schema-validator');
const AuthGuard = require('../api/middleware/auth-guard');

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING OPENAPI CONTRACT & SCHEMA VALIDATOR TESTS');
  console.log('================================================================');

  // TEST 1: OpenAPI 3.1 Spec Completeness
  console.log('\n[TEST 1] Verifying OpenAPI 3.1 Spec for all 19 Modules...');
  const specPath = path.join(__dirname, '../api/openapi-spec.json');
  assert(fs.existsSync(specPath), 'openapi-spec.json must exist');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

  assert.strictEqual(spec.openapi, '3.1.0');
  assert(spec.info.title.includes('CyberVPS Space Station'));

  const requiredEndpoints = [
    '/api/v1/overview',
    '/api/v1/machines',
    '/api/v1/disaster-recovery/profile',
    '/api/v1/apps/list',
    '/api/v1/apps/launch',
    '/api/v1/remote-desktop/session',
    '/api/v1/cluster/topology',
    '/api/v1/custom-hosting',
    '/api/v1/wireguard/peers',
    '/api/v1/device-intel',
    '/api/v1/files/list',
    '/api/v1/terminal/session',
    '/api/v1/processes/list',
    '/api/v1/processes/kill',
    '/api/v1/bridge/mappings',
    '/api/v1/mesh/routes',
    '/api/v1/ports/scan',
    '/api/v1/tunnels/list',
    '/api/v1/doctor/run',
    '/api/v1/audit/logs',
    '/api/v1/settings'
  ];

  for (const ep of requiredEndpoints) {
    assert(spec.paths[ep], `OpenAPI spec must define path: ${ep}`);
  }
  console.log(`  ✅ OpenAPI specification verified: All ${requiredEndpoints.length} critical endpoints documented.`);

  // TEST 2: SchemaValidator - Valid Payload
  console.log('\n[TEST 2] SchemaValidator Valid Payload Verification...');
  const appLaunchSchema = {
    required: ['machine_id', 'executable'],
    properties: {
      machine_id: { type: 'string' },
      executable: { type: 'string' },
      args: { type: 'array' }
    }
  };

  const validPayload = {
    machine_id: 'test_node_01',
    executable: 'chrome.exe',
    args: ['--incognito']
  };

  const validResult = SchemaValidator.validateData(validPayload, appLaunchSchema);
  assert.strictEqual(validResult.valid, true);
  assert.strictEqual(validResult.errors.length, 0);
  console.log('  ✅ Valid payload passed schema verification.');

  // TEST 3: SchemaValidator - Missing Required Fields & Type Mismatches
  console.log('\n[TEST 3] SchemaValidator Rejection of Invalid Payloads...');
  const invalidPayload = {
    executable: 12345, // should be string
    args: 'not-an-array' // should be array
    // missing machine_id
  };

  const invalidResult = SchemaValidator.validateData(invalidPayload, appLaunchSchema);
  assert.strictEqual(invalidResult.valid, false);
  assert(invalidResult.errors.some(e => e.name === 'machine_id'), 'Missing machine_id must be caught');
  assert(invalidResult.errors.some(e => e.name === 'executable'), 'Invalid executable type must be caught');
  assert(invalidResult.errors.some(e => e.name === 'args'), 'Invalid args type must be caught');

  const problemDetails = SchemaValidator.formatProblemDetails('Validation Error', 400, 'Invalid parameters', invalidResult.errors);
  assert.strictEqual(problemDetails.status, 400);
  assert.strictEqual(problemDetails.invalid_params.length, 3);
  console.log('  ✅ RFC 7807 problem details formatted with 3 distinct parameter violations.');

  // TEST 4: AuthGuard - Timing-Safe String Comparison
  console.log('\n[TEST 4] AuthGuard Timing-Safe Secret Comparison...');
  assert.strictEqual(AuthGuard.safeCompare('cybervps_pair_station_2026', 'cybervps_pair_station_2026'), true);
  assert.strictEqual(AuthGuard.safeCompare('cybervps_pair_station_2026', 'wrong_pairing_key'), false);
  assert.strictEqual(AuthGuard.safeCompare('short', 'much_longer_string_attack'), false);
  console.log('  ✅ AuthGuard timing-safe comparison verified.');

  // TEST 5: AuthGuard - Role Separation & Obsolete Token Rejection
  console.log('\n[TEST 5] AuthGuard Role Separation & Token Enforcement...');
  const authGuard = new AuthGuard({
    pairingKey: 'test_operator_key_999',
    enrollmentToken: 'test_enroll_token_888'
  });

  // Valid pairing key -> operator
  const opAuth = authGuard.authenticate({
    headers: { 'x-cvps-pairing-key': 'test_operator_key_999' }
  });
  assert.strictEqual(opAuth.authenticated, true);
  assert.strictEqual(opAuth.role, 'operator');

  // Obsolete master token -> rejected with 401
  const obsoleteAuth = authGuard.authenticate({
    headers: { 'x-cvps-pairing-key': 'test_enroll_token_888' }
  });
  assert.strictEqual(obsoleteAuth.authenticated, false);
  assert.strictEqual(obsoleteAuth.status, 401);
  assert(obsoleteAuth.reason.includes('Obsolete master token'));

  // Node token -> role agent
  const agentAuth = authGuard.authenticate({
    headers: { 'authorization': 'Bearer cvps_node_desktop_test' }
  });
  assert.strictEqual(agentAuth.authenticated, true);
  assert.strictEqual(agentAuth.role, 'agent');
  console.log('  ✅ AuthGuard role boundaries verified: Operator (200), Obsolete (401), Agent (Agent role).');

  console.log('\n================================================================');
  console.log('🎉 ALL OPENAPI & SCHEMA VALIDATOR TESTS PASSED!');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
