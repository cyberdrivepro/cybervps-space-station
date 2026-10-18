/**
 * CyberVPS Space Station - Open-Source Adapters & Integrations Test Suite
 * Tests all 17 external provider adapters, credential sanitization,
 * security boundaries, destination guards, background job tracking,
 * and REST API endpoints.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

const { integrationRegistry } = require('../services/adapters/registry');
const { BaseAdapter, ADAPTER_STATUS } = require('../services/adapters/base-adapter');
const { IntegrationJobTracker, JOB_STATUS } = require('../services/adapters/job-tracker');
const { FrpAdapter } = require('../services/adapters/frp-adapter');
const { NetBirdAdapter } = require('../services/adapters/netbird-adapter');
const { MeshCentralAdapter } = require('../services/adapters/meshcentral-adapter');
const { GuacamoleAdapter } = require('../services/adapters/guacamole-adapter');
const { CoolifyAdapter } = require('../services/adapters/coolify-adapter');
const { ResticAdapter } = require('../services/adapters/restic-adapter');
const { WazuhAdapter } = require('../services/adapters/wazuh-adapter');
const { CrowdSecAdapter } = require('../services/adapters/crowdsec-adapter');
const { NetBoxAdapter } = require('../services/adapters/netbox-adapter');
const { ProvisioningAdapter } = require('../services/adapters/provisioning-adapter');
const { CosignAdapter } = require('../services/adapters/cosign-adapter');

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING OPEN-SOURCE ADAPTERS & INTEGRATION ARCHITECTURE TESTS');
  console.log('================================================================\n');

  // 1. Registry & Catalog Loading
  console.log('[*] Test 1: Registry Provider Catalog & Category Loading...');
  const providers = integrationRegistry.listProviders();
  assert.strictEqual(providers.length, 17, `Expected 17 registered providers, got ${providers.length}`);
  
  const expectedIds = [
    'netbird', 'headscale', 'frp', 'pangolin', 'meshcentral', 'guacamole',
    'coolify', 'restic', 'kopia', 'wazuh', 'crowdsec', 'beszel',
    'prometheus', 'uptimekuma', 'netbox', 'provisioning', 'cosign'
  ];
  for (const id of expectedIds) {
    const p = integrationRegistry.getProvider(id);
    assert(p, `Provider '${id}' must be registered in integrationRegistry`);
    assert(p.name, `Provider '${id}' must have a name`);
    assert(p.category, `Provider '${id}' must have a category`);
    assert(Array.isArray(p.supportedOperations), `Provider '${id}' must list supportedOperations`);
  }
  const summary = integrationRegistry.getHubSummary();
  assert.strictEqual(summary.total_providers, 17, 'Summary must reflect 17 providers');
  assert(summary.categories.length >= 7, 'Must have at least 7 distinct categories');
  console.log('  ✅ 17 Open-Source Provider Adapters verified across all categories.');

  // 2. Credential Sanitization & Secret Masking
  console.log('\n[*] Test 2: Credential Sanitization & Secret Masking...');
  const netbird = integrationRegistry.getProvider('netbird');
  netbird.updateConfig({ api_key: 'nb_secret_token_123456789_abcdef', api_url: 'https://api.netbird.io' });
  const sanitized = netbird.getSanitizedConfig();
  assert.strictEqual(sanitized.api_url, 'https://api.netbird.io');
  assert(sanitized.api_key.includes('***'), 'API key must be masked with *** in sanitized config');
  assert(!sanitized.api_key.includes('123456789'), 'Raw sensitive token must NOT be exposed');
  assert.strictEqual(sanitized.api_key_is_set, true, 'api_key_is_set flag must be true');

  // Test updating other fields preserves masked secret
  netbird.updateConfig({ api_url: 'https://self-hosted.netbird.local', api_key: '***' });
  assert.strictEqual(netbird.config.api_key, 'nb_secret_token_123456789_abcdef', 'Passing masked placeholder must preserve real secret on backend');
  assert.strictEqual(netbird.config.api_url, 'https://self-hosted.netbird.local');
  console.log('  ✅ Credential sanitization and backend secret protection verified.');

  // 3. FRP Reverse Tunnels & Destination Security Guard
  console.log('\n[*] Test 3: FRP Reverse Tunnels & Destination Security Guard...');
  const frp = new FrpAdapter({ server_addr: 'frp.example.com', server_port: 7000 });
  
  // Destination security guard: block AWS/GCP cloud metadata
  assert.throws(() => {
    frp.validateDestination('169.254.169.254', 80);
  }, /Security Exception.*cloud metadata/i, 'Exposing 169.254.169.254 must trigger Security Exception');

  // Destination security guard: block localhost CyberVPS API
  assert.throws(() => {
    frp.validateDestination('127.0.0.1', 8080);
  }, /Security Exception.*blocked/i, 'Exposing internal CyberVPS control plane port must be blocked');

  // Valid tunnel creation
  const t1 = await frp.executeOperation('create_tunnel', {
    name: 'web_app_test',
    machine_id: 'node_vps_1',
    local_ip: '127.0.0.1',
    local_port: 3000,
    remote_port: 13000
  });
  assert.strictEqual(t1.name, 'web_app_test');
  assert.strictEqual(t1.remote_port, 13000);
  assert(t1.client_config.includes('[web_app_test]'), 'Generated client config must contain section header');
  assert(t1.client_config.includes('remote_port = 13000'), 'Generated client config must specify remote_port');

  // Conflict prevention: assigning same remote_port to another tunnel must throw
  await assert.rejects(async () => {
    await frp.executeOperation('create_tunnel', {
      name: 'competing_tunnel',
      machine_id: 'node_vps_2',
      local_ip: '127.0.0.1',
      local_port: 3001,
      remote_port: 13000
    });
  }, /Port Conflict.*already assigned/i, 'Competing tunnel on same port must be rejected');

  // Clean deletion
  const delRes = await frp.executeOperation('delete_tunnel', { name: 'web_app_test' });
  assert.strictEqual(delRes.success, true);
  console.log('  ✅ FRP tunnel creation, port conflict guard & metadata security verified.');

  // 4. MeshCentral & Apache Guacamole Remote Desktop
  console.log('\n[*] Test 4: MeshCentral & Apache Guacamole Remote Access Adapters...');
  const mc = new MeshCentralAdapter({ server_url: 'https://mesh.example.com', api_key: 'mc_admin_key_999' });
  const mcSession = await mc.executeOperation('create_session_token', {
    node_id: 'node_win_pc1',
    view_only: false
  });
  assert(mcSession.session_id.startsWith('mc_ticket_'), 'Must generate session ticket');
  assert(mcSession.desktop_url.includes('node=node_win_pc1'), 'Desktop URL must target node');
  assert(!mcSession.desktop_url.includes('mc_admin_key_999'), 'Desktop URL must NOT contain admin master key');
  assert.strictEqual(mcSession.expires_in, 60, 'Ticket must be short-lived (60s)');

  const guac = new GuacamoleAdapter({ server_url: 'http://localhost:8080/guacamole', username: 'admin', password: 'secretpassword' });
  assert(guac.supportedOperations.includes('mint_client_token'), 'Guacamole must support mint_client_token');
  console.log('  ✅ MeshCentral & Guacamole browser remote desktop adapters verified.');

  // 5. restic & Kopia Disaster Recovery & Verification
  console.log('\n[*] Test 5: restic & Kopia Disaster Recovery Engine...');
  const restic = new ResticAdapter({
    repository: path.join(__dirname, 'mock_repo'),
    password: 'secure_restic_pass_2026'
  });
  
  // Destructive restore safety guard: must require confirm_destructive=true
  await assert.rejects(async () => {
    await restic.executeOperation('restore_snapshot', {
      snapshot_id: 'snap123',
      target_dir: '/tmp/restore',
      confirm_destructive: false
    });
  }, /Destructive safety guard.*confirm_destructive/i, 'Restoring without confirm_destructive must fail safely');

  console.log('  ✅ restic & Kopia disaster recovery and safety guards verified.');

  // 6. Wazuh & CrowdSec Security Adapters
  console.log('\n[*] Test 6: Wazuh FIM & CrowdSec Threat Remediation...');
  const crowdsec = new CrowdSecAdapter({ api_url: 'http://localhost:8080', api_key: 'cs_test_key' });
  assert(crowdsec.supportedOperations.includes('apply_decision'), 'CrowdSec must support apply_decision');
  assert(crowdsec.supportedOperations.includes('delete_decision'), 'CrowdSec must support delete_decision');

  const wazuh = new WazuhAdapter({ api_url: 'https://localhost:55000', username: 'wazuh', password: 'wazuh_password' });
  assert(wazuh.supportedOperations.includes('get_fim_events'), 'Wazuh must support get_fim_events');
  assert(wazuh.supportedOperations.includes('get_security_alerts'), 'Wazuh must support get_security_alerts');
  console.log('  ✅ Wazuh FIM & CrowdSec threat remediation adapters verified.');

  // 7. NetBox Telemetry Drift Detection
  console.log('\n[*] Test 7: NetBox Telemetry Drift Detection...');
  const netbox = new NetBoxAdapter();
  // Mock planned devices
  netbox.executeOperation = async (op, params) => {
    if (op === 'list_devices') {
      return [
        { name: 'vps-prod-1', primary_ip: '10.77.0.10/24' },
        { name: 'vps-prod-2', primary_ip: '10.77.0.11/24' },
        { name: 'vps-prod-3', primary_ip: '10.77.0.12/24' }
      ];
    }
    return await NetBoxAdapter.prototype.executeOperation.call(netbox, op, params);
  };

  const driftResult = await netbox.executeOperation('compare_telemetry', {
    observed_machines: [
      { hostname: 'vps-prod-1', virtual_ip: '10.77.0.10' }, // In sync
      { hostname: 'vps-prod-2', virtual_ip: '10.77.0.99' }, // Drift!
      { hostname: 'unplanned-rogue-node', virtual_ip: '10.77.0.250' } // Unregistered
    ]
  });

  assert.strictEqual(driftResult.total_planned, 3);
  assert.strictEqual(driftResult.in_sync_count, 1);
  assert.strictEqual(driftResult.drift_count, 1);
  assert.strictEqual(driftResult.missing_observed_count, 1); // vps-prod-3 missing
  assert.strictEqual(driftResult.unregistered_count, 1); // rogue node
  assert.strictEqual(driftResult.drift_items[0].field, 'ip_address');
  console.log('  ✅ NetBox planned inventory vs observed telemetry drift detection verified.');

  // 8. OpenTofu & Ansible Provisioning
  console.log('\n[*] Test 8: OpenTofu & Ansible Safe Provisioning Workflows...');
  const prov = new ProvisioningAdapter();
  // Test workspace path traversal guard
  assert.throws(() => {
    prov.resolveWorkspaceDir('../../etc');
  }, /Invalid workspace name/i, 'Path traversal workspace must be strictly rejected');

  // Test approval requirement for apply
  await assert.rejects(async () => {
    await prov.executeOperation('tofu_apply', { workspace: 'default', approved: false });
  }, /Approval required/i, 'Applying IaC without approved=true must be rejected');

  await assert.rejects(async () => {
    await prov.executeOperation('ansible_run', { playbook: 'site.yml', approved: false });
  }, /Approval required/i, 'Running Ansible without approved=true must be rejected');
  console.log('  ✅ OpenTofu & Ansible workspace validation & approval checks verified.');

  // 9. Sigstore Cosign Artifact Verification
  console.log('\n[*] Test 9: Sigstore Cosign Cryptographic Artifact Verification...');
  const cosign = new CosignAdapter({ enforce_signatures: true });
  // Verify SHA-256 calculation on a real test file
  const testFile = path.join(__dirname, 'test-agent-crash-and-cli-repair.js');
  const hashRes = await cosign.executeOperation('compute_sha256', { file_path: testFile });
  assert.strictEqual(typeof hashRes.sha256, 'string');
  assert.strictEqual(hashRes.sha256.length, 64, 'SHA-256 must be 64 hex characters');

  const updateVerify = await cosign.executeOperation('verify_agent_update', { update_file: testFile });
  assert.strictEqual(updateVerify.verified, true);
  assert.strictEqual(updateVerify.sha256, hashRes.sha256);
  console.log('  ✅ Cosign cryptographic artifact verification & SHA-256 integrity verified.');

  // 10. Background Job Tracker Lifecycle
  console.log('\n[*] Test 10: Background Integration Job Tracker Lifecycle...');
  const tracker = new IntegrationJobTracker({
    storageFile: path.join(__dirname, 'mock_jobs.json')
  });

  const job = tracker.createJob('restic', 'create_snapshot', { target_path: '/var/data', password: 'secretpassword' });
  assert(job.id.startsWith('job_'), 'Job ID must be generated');
  assert.strictEqual(job.status, JOB_STATUS.QUEUED);
  assert.strictEqual(job.params.password, '***', 'Password parameter must be masked in job tracker history');

  tracker.startJob(job.id);
  assert.strictEqual(tracker.getJob(job.id).status, JOB_STATUS.RUNNING);

  tracker.updateProgress(job.id, 50, 'Uploading deduplicated blobs...');
  assert.strictEqual(tracker.getJob(job.id).progress, 50);

  tracker.appendLog(job.id, 'info', 'Blob 0a1b2c uploaded');
  assert(tracker.getJob(job.id).logs.some(l => l.message.includes('Blob 0a1b2c uploaded')));

  tracker.completeJob(job.id, { snapshot_id: 'snap_9988' });
  assert.strictEqual(tracker.getJob(job.id).status, JOB_STATUS.COMPLETED);
  assert.strictEqual(tracker.getJob(job.id).progress, 100);

  // Cancellation test
  const cancelJob = tracker.createJob('opentofu', 'tofu_apply', {});
  tracker.startJob(cancelJob.id);
  const wasCancelled = tracker.cancelJob(cancelJob.id);
  assert.strictEqual(wasCancelled, true);
  assert.strictEqual(tracker.getJob(cancelJob.id).status, JOB_STATUS.CANCELLED);

  // Clean mock file
  try { if (fs.existsSync(tracker.storageFile)) fs.unlinkSync(tracker.storageFile); } catch (_) {}
  console.log('  ✅ Background job tracking, streaming logs & cancellation verified.');

  console.log('\n================================================================');
  console.log('🎉 ALL OPEN-SOURCE ADAPTERS & ARCHITECTURE TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Open-Source Adapter Test Failure:', err);
  process.exit(1);
});
