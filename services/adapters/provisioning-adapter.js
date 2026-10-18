/**
 * CyberVPS Space Station - OpenTofu & Ansible Provisioning Adapter
 * Manages infrastructure as code (IaC) and configuration management workflows.
 * Enforces structured argument arrays (no shell concatenation), workspace boundaries,
 * plan/preview approval stages, cancellation, and background progress streaming.
 */

const { BaseAdapter, ADAPTER_STATUS } = require('./base-adapter');
const path = require('path');
const fs = require('fs');

class ProvisioningAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({
      id: 'provisioning',
      name: 'OpenTofu & Ansible Provisioning Engine',
      category: 'provisioning',
      description: 'Declarative infrastructure provisioning and configuration management with preview and approval stages.',
      version: '1.7.0',
      supportedOperations: [
        'test', 'tofu_init', 'tofu_plan', 'tofu_apply',
        'ansible_check', 'ansible_run', 'list_workspaces'
      ],
      config: {
        tofu_binary: process.env.TOFU_BINARY || 'tofu',
        ansible_binary: process.env.ANSIBLE_BINARY || 'ansible-playbook',
        workspace_root: process.env.PROVISIONING_WORKSPACE || path.join(process.cwd(), 'data', 'workspaces'),
        ...config
      }
    });

    this.workspaces = new Map();
  }

  isConfigured() {
    return true; // Uses system executables
  }

  /**
   * Validate that workspace directory is strictly within the allowed workspace_root
   */
  resolveWorkspaceDir(workspaceName) {
    if (!workspaceName || !/^[a-zA-Z0-9_\-\.]+$/.test(workspaceName)) {
      throw new Error(`Invalid workspace name: '${workspaceName}'. Must be alphanumeric characters, hyphens, or underscores.`);
    }
    const root = path.resolve(this.config.workspace_root);
    const target = path.resolve(root, workspaceName);
    if (!target.startsWith(root)) {
      throw new Error(`Security Exception: Workspace path traversal detected.`);
    }
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    return target;
  }

  async testConnection() {
    const tofuBin = this.config.tofu_binary || 'tofu';
    const ansBin = this.config.ansible_binary || 'ansible-playbook';

    const tofuRes = await this.runSubprocess(tofuBin, ['version'], { timeout: 3000 });
    const ansRes = await this.runSubprocess(ansBin, ['--version'], { timeout: 3000 });

    const tofuAvailable = tofuRes.code === 0;
    const ansAvailable = ansRes.code === 0;

    if (tofuAvailable || ansAvailable) {
      this.status = ADAPTER_STATUS.CONNECTED;
      this.lastSync = new Date().toISOString();
      return {
        success: true,
        status: this.status,
        details: {
          tofu: tofuAvailable ? tofuRes.stdout.split('\n')[0] : 'Not installed',
          ansible: ansAvailable ? ansRes.stdout.split('\n')[0] : 'Not installed',
          workspace_root: this.config.workspace_root
        }
      };
    } else {
      this.status = ADAPTER_STATUS.DEGRADED;
      return {
        success: false,
        status: this.status,
        error: 'Neither OpenTofu nor Ansible executables were discovered in PATH.'
      };
    }
  }

  async executeOperation(operation, params = {}, jobContext = null) {
    await super.executeOperation(operation, params, jobContext);
    const tofuBin = this.config.tofu_binary || 'tofu';
    const ansBin = this.config.ansible_binary || 'ansible-playbook';

    switch (operation) {
      case 'test':
        return await this.testConnection();

      case 'list_workspaces': {
        const root = path.resolve(this.config.workspace_root);
        if (!fs.existsSync(root)) return [];
        return fs.readdirSync(root, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => ({ name: d.name, path: path.join(root, d.name) }));
      }

      case 'tofu_init': {
        const wsName = params.workspace || 'default';
        const wsDir = this.resolveWorkspaceDir(wsName);
        if (jobContext) {
          jobContext.startJob(jobContext.id);
          jobContext.appendLog('info', `Running tofu init in ${wsDir}...`);
        }
        const res = await this.runSubprocess(tofuBin, ['init', '-no-color'], {
          cwd: wsDir,
          timeout: 60000,
          onLog: (t, m) => { if (jobContext) jobContext.appendLog(t, m); }
        });
        if (res.code !== 0) {
          if (jobContext) jobContext.failJob(jobContext.id, res.stderr || res.stdout);
          throw new Error(`tofu init failed: ${res.stderr || res.stdout}`);
        }
        if (jobContext) jobContext.completeJob(jobContext.id, { output: res.stdout });
        return { success: true, output: res.stdout };
      }

      case 'tofu_plan': {
        const wsName = params.workspace || 'default';
        const wsDir = this.resolveWorkspaceDir(wsName);
        if (jobContext) {
          jobContext.startJob(jobContext.id);
          jobContext.appendLog('info', `Generating OpenTofu execution plan (preview)...`);
        }
        const planFile = path.join(wsDir, 'tfplan.binary');
        const res = await this.runSubprocess(tofuBin, ['plan', '-no-color', `-out=${planFile}`], {
          cwd: wsDir,
          timeout: 90000,
          onLog: (t, m) => { if (jobContext) jobContext.appendLog(t, m); }
        });
        if (res.code !== 0) {
          if (jobContext) jobContext.failJob(jobContext.id, res.stderr || res.stdout);
          throw new Error(`tofu plan failed: ${res.stderr || res.stdout}`);
        }
        const result = { success: true, plan_generated: true, output: res.stdout, plan_file: planFile };
        if (jobContext) jobContext.completeJob(jobContext.id, result);
        return result;
      }

      case 'tofu_apply': {
        const wsName = params.workspace || 'default';
        const wsDir = this.resolveWorkspaceDir(wsName);
        if (!params.approved) {
          throw new Error('Approval required: OpenTofu apply modifies physical resources and requires explicit approved=true.');
        }
        if (jobContext) {
          jobContext.startJob(jobContext.id);
          jobContext.appendLog('info', `Applying OpenTofu configuration with approved plan...`);
        }
        const planFile = path.join(wsDir, 'tfplan.binary');
        const applyArgs = fs.existsSync(planFile)
          ? ['apply', '-no-color', '-auto-approve', planFile]
          : ['apply', '-no-color', '-auto-approve'];

        const res = await this.runSubprocess(tofuBin, applyArgs, {
          cwd: wsDir,
          timeout: 180000,
          onLog: (t, m) => { if (jobContext) jobContext.appendLog(t, m); }
        });

        if (res.code !== 0) {
          if (jobContext) jobContext.failJob(jobContext.id, res.stderr || res.stdout);
          throw new Error(`tofu apply failed: ${res.stderr || res.stdout}`);
        }
        if (jobContext) jobContext.completeJob(jobContext.id, { output: res.stdout });
        return { success: true, output: res.stdout };
      }

      case 'ansible_check': {
        const { playbook, inventory = 'localhost,' } = params;
        if (!playbook) throw new Error('playbook path is required');
        if (jobContext) {
          jobContext.startJob(jobContext.id);
          jobContext.appendLog('info', `Running Ansible dry-run (--check): ${playbook}`);
        }
        const res = await this.runSubprocess(ansBin, ['-i', inventory, playbook, '--check'], {
          timeout: 60000,
          onLog: (t, m) => { if (jobContext) jobContext.appendLog(t, m); }
        });
        const result = { success: res.code === 0, output: res.stdout, error: res.stderr };
        if (jobContext) {
          if (res.code === 0) jobContext.completeJob(jobContext.id, result);
          else jobContext.failJob(jobContext.id, res.stderr);
        }
        return result;
      }

      case 'ansible_run': {
        const { playbook, inventory = 'localhost,', approved } = params;
        if (!playbook) throw new Error('playbook path is required');
        if (!approved) throw new Error('Approval required: Ansible execution requires approved=true.');
        if (jobContext) {
          jobContext.startJob(jobContext.id);
          jobContext.appendLog('info', `Executing Ansible playbook: ${playbook}`);
        }
        const res = await this.runSubprocess(ansBin, ['-i', inventory, playbook], {
          timeout: 120000,
          onLog: (t, m) => { if (jobContext) jobContext.appendLog(t, m); }
        });
        if (res.code !== 0) {
          if (jobContext) jobContext.failJob(jobContext.id, res.stderr);
          throw new Error(`Ansible failed: ${res.stderr}`);
        }
        if (jobContext) jobContext.completeJob(jobContext.id, { output: res.stdout });
        return { success: true, output: res.stdout };
      }

      default:
        throw new Error(`Unsupported provisioning operation: ${operation}`);
    }
  }
}

module.exports = { ProvisioningAdapter };
