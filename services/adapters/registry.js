/**
 * CyberVPS Space Station - Open-Source Integrations Registry
 * Central orchestrator and catalog for all 15+ external open-source adapters.
 * Manages configuration persistence, credential masking, live connectivity testing,
 * background job tracking, and unified dispatch across the platform.
 */

const fs = require('fs');
const path = require('path');

const { IntegrationJobTracker } = require('./job-tracker');
const { NetBirdAdapter } = require('./netbird-adapter');
const { HeadscaleAdapter } = require('./headscale-adapter');
const { FrpAdapter } = require('./frp-adapter');
const { PangolinAdapter } = require('./pangolin-adapter');
const { MeshCentralAdapter } = require('./meshcentral-adapter');
const { GuacamoleAdapter } = require('./guacamole-adapter');
const { CoolifyAdapter } = require('./coolify-adapter');
const { ResticAdapter } = require('./restic-adapter');
const { KopiaAdapter } = require('./kopia-adapter');
const { WazuhAdapter } = require('./wazuh-adapter');
const { CrowdSecAdapter } = require('./crowdsec-adapter');
const { BeszelAdapter } = require('./beszel-adapter');
const { PrometheusAdapter } = require('./prometheus-adapter');
const { UptimeKumaAdapter } = require('./uptimekuma-adapter');
const { NetBoxAdapter } = require('./netbox-adapter');
const { ProvisioningAdapter } = require('./provisioning-adapter');
const { CosignAdapter } = require('./cosign-adapter');

class IntegrationRegistry {
  constructor(options = {}) {
    this.storageFile = options.storageFile || path.join(process.cwd(), 'data', 'integrations_config.json');
    this.jobTracker = new IntegrationJobTracker({
      storageFile: path.join(process.cwd(), 'data', 'integration_jobs.json')
    });

    this.providers = new Map();
    this.registerDefaults();
    this.loadFromDisk();
  }

  registerDefaults() {
    const defaultClasses = [
      NetBirdAdapter,
      HeadscaleAdapter,
      FrpAdapter,
      PangolinAdapter,
      MeshCentralAdapter,
      GuacamoleAdapter,
      CoolifyAdapter,
      ResticAdapter,
      KopiaAdapter,
      WazuhAdapter,
      CrowdSecAdapter,
      BeszelAdapter,
      PrometheusAdapter,
      UptimeKumaAdapter,
      NetBoxAdapter,
      ProvisioningAdapter,
      CosignAdapter
    ];

    for (const AdapterClass of defaultClasses) {
      try {
        const instance = new AdapterClass();
        this.providers.set(instance.id, instance);
      } catch (err) {
        console.error(`[!] Failed initializing adapter ${AdapterClass.name}:`, err);
      }
    }
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const saved = JSON.parse(raw);
        if (typeof saved === 'object' && saved !== null) {
          for (const [id, cfg] of Object.entries(saved)) {
            const provider = this.providers.get(id);
            if (provider && cfg) {
              provider.config = { ...provider.config, ...cfg };
            }
          }
        }
      }
    } catch (_) {}
  }

  saveToDisk() {
    try {
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const serialized = {};
      for (const [id, provider] of this.providers) {
        serialized[id] = provider.config;
      }
      fs.writeFileSync(this.storageFile, JSON.stringify(serialized, null, 2), 'utf8');
    } catch (_) {}
  }

  getProvider(id) {
    if (!id) return null;
    const direct = this.providers.get(id);
    if (direct) return direct;
    // Map aliases (e.g. 'uptime_kuma' or 'uptime-kuma' -> 'uptimekuma')
    const normalized = id.toLowerCase().replace(/[-_]/g, '');
    for (const [key, p] of this.providers) {
      if (key.toLowerCase().replace(/[-_]/g, '') === normalized) {
        return p;
      }
    }
    return null;
  }

  listProviders() {
    return Array.from(this.providers.values()).map(p => ({
      ...p.getStatus(),
      sanitizedConfig: p.getSanitizedConfig()
    }));
  }

  async testProvider(id, testConfig = null) {
    const provider = this.getProvider(id);
    if (!provider) throw new Error(`Provider '${id}' not found in registry`);

    if (testConfig) {
      provider.updateConfig(testConfig);
    }
    const result = await provider.testConnection();
    this.saveToDisk();
    return result;
  }

  updateProviderConfig(id, newConfig) {
    const provider = this.getProvider(id);
    if (!provider) throw new Error(`Provider '${id}' not found in registry`);

    const sanitized = provider.updateConfig(newConfig);
    this.saveToDisk();
    return sanitized;
  }

  async execute(id, operation, params = {}) {
    const provider = this.getProvider(id);
    if (!provider) throw new Error(`Provider '${id}' not found in registry`);

    // Create tracked job if operation is long-running
    const longRunning = ['create_snapshot', 'verify_integrity', 'restore_snapshot', 'deploy_application', 'tofu_plan', 'tofu_apply', 'ansible_run', 'verify_agent_update'];
    let job = null;
    if (longRunning.includes(operation)) {
      job = this.jobTracker.createJob(id, operation, params);
    }

    try {
      const result = await provider.executeOperation(operation, params, job);
      return {
        success: true,
        provider: id,
        operation,
        job_id: job ? job.id : null,
        data: result
      };
    } catch (err) {
      if (job) this.jobTracker.failJob(job.id, err);
      throw err;
    }
  }

  getJobTracker() {
    return this.jobTracker;
  }

  getHubSummary() {
    const all = this.listProviders();
    const categories = {};
    let connectedCount = 0;
    let configuredCount = 0;

    for (const p of all) {
      if (!categories[p.category]) {
        categories[p.category] = { category: p.category, providers: [], connected: 0, total: 0 };
      }
      categories[p.category].providers.push(p);
      categories[p.category].total++;
      if (p.status === 'connected') {
        categories[p.category].connected++;
        connectedCount++;
      }
      if (p.configured) configuredCount++;
    }

    return {
      total_providers: all.length,
      connected_count: connectedCount,
      configured_count: configuredCount,
      categories: Object.values(categories),
      recent_jobs: this.jobTracker.listJobs().slice(0, 5)
    };
  }
}

// Singleton instance
const integrationRegistry = new IntegrationRegistry();

module.exports = {
  IntegrationRegistry,
  integrationRegistry
};
