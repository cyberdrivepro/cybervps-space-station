/**
 * CyberVPS Space Station - restic Disaster Recovery & Snapshot Adapter
 * Integrates restic (BSD-2-Clause) for encrypted, deduplicated, snapshot-based backups.
 * Manages repository init, snapshot creation, cryptographic integrity checks (restic check),
 * restore previews (restic ls), and safe destination restores with job tracking.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');
const path = require('path');
const fs = require('fs');

class ResticAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'restic',
      name: 'restic Encrypted Snapshot Engine',
      category: 'backup',
      description: 'Fast, secure, deduplicated backup program with cryptographic repository verification.',
      version: '0.16.4',
      supportedOperations: [
        'test', 'init_repo', 'create_snapshot', 'list_snapshots',
        'verify_integrity', 'restore_preview', 'restore_snapshot', 'apply_retention'
      ],
      config: {
        binary_path: process.env.RESTIC_BINARY || 'restic',
        repository: process.env.RESTIC_REPOSITORY || path.join(process.cwd(), 'data', 'restic_repo'),
        password: process.env.RESTIC_PASSWORD || '',
        ...config
      }
    });
  }

  isConfigured() {
    return Boolean(this.config.repository && this.config.password);
  }

  getEnv() {
    return {
      ...process.env,
      RESTIC_REPOSITORY: this.config.repository,
      RESTIC_PASSWORD: this.config.password
    };
  }

  async testConnection() {
    const binary = this.config.binary_path || 'restic';
    // 1. Verify binary exists and reports version
    const verRes = await this.runSubprocess(binary, ['version'], { timeout: 4000 });
    if (verRes.code !== 0) {
      this.status = ADAPTER_STATUS.DISCONNECTED;
      this.lastError = `restic executable not found or errored: ${verRes.stderr || verRes.error || 'Check PATH'}`;
      return { success: false, status: this.status, error: this.lastError };
    }

    if (!this.isConfigured()) {
      this.status = ADAPTER_STATUS.UNCONFIGURED;
      return {
        success: false,
        status: this.status,
        error: 'restic repository path or password not configured.',
        details: { binary_version: verRes.stdout }
      };
    }

    // 2. Test repository access
    const snapRes = await this.runSubprocess(binary, ['snapshots', '--json'], {
      env: this.getEnv(),
      timeout: 6000
    });

    if (snapRes.code === 0) {
      this.status = ADAPTER_STATUS.CONNECTED;
      this.lastSync = new Date().toISOString();
      this.lastError = null;
      let snapCount = 0;
      try { snapCount = JSON.parse(snapRes.stdout).length; } catch (_) {}
      return {
        success: true,
        status: this.status,
        details: {
          binary_version: verRes.stdout,
          repository: this.config.repository,
          snapshot_count: snapCount
        }
      };
    } else if (snapRes.stderr.includes('Is there a repository at') || snapRes.stderr.includes('config file not found')) {
      this.status = ADAPTER_STATUS.DEGRADED;
      this.lastError = 'Repository path reachable but uninitialized. Run init_repo.';
      return { success: false, status: this.status, needs_init: true, error: this.lastError };
    } else if (snapRes.stderr.includes('wrong password') || snapRes.stderr.includes('keystore')) {
      this.status = ADAPTER_STATUS.UNAUTHORIZED;
      this.lastError = 'Invalid repository password.';
      return { success: false, status: this.status, error: this.lastError };
    } else {
      this.status = ADAPTER_STATUS.DEGRADED;
      this.lastError = snapRes.stderr;
      return { success: false, status: this.status, error: snapRes.stderr };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);
    const binary = this.config.binary_path || 'restic';

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'init_repo': {
        if (!this.config.password) throw new Error('Repository password is required to initialize repository');
        const res = await this.runSubprocess(binary, ['init', '--json'], {
          env: this.getEnv(),
          timeout: 10000
        });
        if (res.code !== 0) throw new Error(`restic init failed: ${res.stderr}`);
        this.status = ADAPTER_STATUS.CONNECTED;
        return { success: true, message: 'Repository initialized successfully', repository: this.config.repository };
      }

      case 'list_snapshots': {
        const res = await this.runSubprocess(binary, ['snapshots', '--json'], {
          env: this.getEnv(),
          timeout: 10000
        });
        if (res.code !== 0) throw new Error(`restic snapshots failed: ${res.stderr}`);
        try {
          return JSON.parse(res.stdout);
        } catch (_) {
          return [];
        }
      }

      case 'create_snapshot': {
        const targetPath = params.path || params.target_path;
        if (!targetPath) throw new Error('target_path is required for creating a snapshot');
        if (!fs.existsSync(targetPath)) throw new Error(`Target path does not exist on disk: ${targetPath}`);

        if (jobContext) {
          jobContext.startJob(jobContext.id);
          jobContext.appendLog('info', `Executing restic backup for path: ${targetPath}`);
        }

        const args = ['backup', targetPath, '--json'];
        if (params.tags && Array.isArray(params.tags)) {
          for (const t of params.tags) args.push('--tag', t);
        }

        const res = await this.runSubprocess(binary, args, {
          env: this.getEnv(),
          timeout: params.timeout || 120000,
          onLog: (type, text) => {
            if (jobContext) jobContext.appendLog(type, text);
          }
        });

        if (res.code !== 0) {
          if (jobContext) jobContext.failJob(jobContext.id, res.stderr);
          throw new Error(`restic backup failed: ${res.stderr}`);
        }

        let summary = { raw: res.stdout };
        try {
          const lines = res.stdout.split('\n').filter(Boolean);
          const lastJson = JSON.parse(lines[lines.length - 1]);
          summary = lastJson;
        } catch (_) {}

        if (jobContext) {
          jobContext.completeJob(jobContext.id, summary);
        }
        return { success: true, summary };
      }

      case 'verify_integrity': {
        if (jobContext) {
          jobContext.startJob(jobContext.id);
          jobContext.appendLog('info', `Running repository cryptographic integrity check (restic check)...`);
        }
        const args = ['check'];
        if (params.read_data) args.push('--read-data');

        const res = await this.runSubprocess(binary, args, {
          env: this.getEnv(),
          timeout: 60000,
          onLog: (type, text) => {
            if (jobContext) jobContext.appendLog(type, text);
          }
        });

        const verified = res.code === 0 && res.stdout.includes('no errors were found');
        const result = {
          verified,
          output: res.stdout,
          error: res.code !== 0 ? res.stderr : null
        };
        if (jobContext) {
          if (verified) jobContext.completeJob(jobContext.id, result);
          else jobContext.failJob(jobContext.id, res.stderr || 'Integrity errors detected');
        }
        return result;
      }

      case 'restore_preview': {
        const snapshotId = params.snapshot_id;
        if (!snapshotId) throw new Error('snapshot_id is required');
        const res = await this.runSubprocess(binary, ['ls', snapshotId, '--json'], {
          env: this.getEnv(),
          timeout: 15000
        });
        if (res.code !== 0) throw new Error(`restic ls failed: ${res.stderr}`);
        const files = [];
        for (const line of res.stdout.split('\n')) {
          if (!line.trim()) continue;
          try { files.push(JSON.parse(line)); } catch (_) {}
        }
        return { snapshot_id: snapshotId, files_count: files.length, preview: files.slice(0, 100) };
      }

      case 'restore_snapshot': {
        const { snapshot_id, target_dir, confirm_destructive } = params;
        if (!snapshot_id) throw new Error('snapshot_id is required');
        if (!target_dir) throw new Error('target_dir is required');
        if (!confirm_destructive) {
          throw new Error('Destructive safety guard: confirm_destructive must be explicitly true to restore files.');
        }

        if (jobContext) {
          jobContext.startJob(jobContext.id);
          jobContext.appendLog('info', `Restoring snapshot ${snapshot_id} to destination: ${target_dir}`);
        }

        const res = await this.runSubprocess(binary, ['restore', snapshot_id, '--target', target_dir], {
          env: this.getEnv(),
          timeout: 120000,
          onLog: (type, text) => {
            if (jobContext) jobContext.appendLog(type, text);
          }
        });

        if (res.code !== 0) {
          if (jobContext) jobContext.failJob(jobContext.id, res.stderr);
          throw new Error(`restic restore failed: ${res.stderr}`);
        }

        const result = { success: true, snapshot_id, target_dir, output: res.stdout };
        if (jobContext) jobContext.completeJob(jobContext.id, result);
        return result;
      }

      case 'apply_retention': {
        const keepDaily = params.keep_daily || 7;
        const keepWeekly = params.keep_weekly || 4;
        const res = await this.runSubprocess(binary, [
          'forget',
          '--keep-daily', String(keepDaily),
          '--keep-weekly', String(keepWeekly),
          '--prune'
        ], {
          env: this.getEnv(),
          timeout: 60000
        });
        if (res.code !== 0) throw new Error(`Retention policy application failed: ${res.stderr}`);
        return { success: true, output: res.stdout };
      }

      default:
        throw new Error(`Unsupported restic operation: ${operation}`);
    }
  }
}

module.exports = { ResticAdapter };
