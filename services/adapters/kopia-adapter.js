/**
 * CyberVPS Space Station - Kopia Backup Adapter
 * Integrates Kopia (Apache-2.0) for fast, encrypted, snapshot-based backups.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');

class KopiaAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'kopia',
      name: 'Kopia Encrypted Backup',
      category: 'backup',
      description: 'Cross-platform, encrypted, snapshot-based backup tool.',
      version: '0.15.0',
      supportedOperations: ['test', 'list_snapshots', 'create_snapshot', 'verify'],
      config: {
        binary_path: process.env.KOPIA_BINARY || 'kopia',
        repository_config: process.env.KOPIA_CONFIG_PATH || '',
        password: process.env.KOPIA_PASSWORD || '',
        ...config
      }
    });
  }

  isConfigured() {
    return Boolean(this.config.repository_config && this.config.password);
  }

  getEnv() {
    return {
      ...process.env,
      KOPIA_PASSWORD: this.config.password,
      KOPIA_CONFIG_PATH: this.config.repository_config
    };
  }

  async testConnection() {
    const binary = this.config.binary_path || 'kopia';
    const verRes = await this.runSubprocess(binary, ['--version'], { timeout: 4000 });
    if (verRes.code !== 0) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = 'kopia executable not found';
      return { success: false, status: this.status, error: this.lastError };
    }

    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return { success: false, status: this.status, error: 'Kopia repository config or password not configured' };
    }

    const stRes = await this.runSubprocess(binary, ['repository', 'status', '--json'], { env: this.getEnv(), timeout: 5000 });
    if (stRes.code === 0) {
      this.status = ADAPTER_STATUS.CONNECTED;
      this.lastSync = new Date().toISOString();
      return { success: true, status: this.status, details: { binary: verRes.stdout } };
    } else {
      this.status = ADAPTER_STATUS.DEGRADED;
      return { success: false, status: this.status, error: stRes.stderr };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);
    const binary = this.config.binary_path || 'kopia';

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_snapshots': {
        const res = await this.runSubprocess(binary, ['snapshot', 'list', '--json'], { env: this.getEnv(), timeout: 10000 });
        if (res.code !== 0) throw new Error(`kopia snapshot list failed: ${res.stderr}`);
        try { return JSON.parse(res.stdout); } catch (_) { return []; }
      }

      case 'create_snapshot': {
        const { target_path } = params;
        if (!target_path) throw new Error('target_path is required');
        const res = await this.runSubprocess(binary, ['snapshot', 'create', target_path, '--json'], { env: this.getEnv(), timeout: 60000 });
        if (res.code !== 0) throw new Error(`kopia snapshot create failed: ${res.stderr}`);
        return { success: true, output: res.stdout };
      }

      case 'verify': {
        const res = await this.runSubprocess(binary, ['snapshot', 'verify'], { env: this.getEnv(), timeout: 30000 });
        return { verified: res.code === 0, output: res.stdout, error: res.stderr };
      }

      default:
        throw new Error(`Unsupported Kopia operation: ${operation}`);
    }
  }
}

module.exports = { KopiaAdapter };
