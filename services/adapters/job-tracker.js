/**
 * CyberVPS Space Station - Integration Background Job Tracker
 * Tracks asynchronous deployment, backup, restore, scanning, and verification jobs
 * with live streaming logs, cancelability, and persistent execution history.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

class IntegrationJobTracker {
  constructor(options = {}) {
    this.jobs = new Map();
    this.maxHistory = options.maxHistory || 100;
    this.storageFile = options.storageFile || path.join(process.cwd(), 'data', 'integration_jobs.json');
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const j of parsed) {
            this.jobs.set(j.id, j);
          }
        }
      }
    } catch (_) {}
  }

  saveToDisk() {
    try {
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const recent = Array.from(this.jobs.values()).slice(-this.maxHistory);
      fs.writeFileSync(this.storageFile, JSON.stringify(recent, null, 2), 'utf8');
    } catch (_) {}
  }

  /**
   * Create a new tracked background job
   */
  createJob(providerId, operation, params = {}) {
    const id = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Sanitize parameters so no secrets leak into job history
    const sanitizedParams = { ...params };
    for (const key of Object.keys(sanitizedParams)) {
      if (/password|token|secret|key/i.test(key)) {
        sanitizedParams[key] = '***';
      }
    }

    const job = {
      id,
      providerId,
      operation,
      params: sanitizedParams,
      status: JOB_STATUS.QUEUED,
      progress: 0,
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `Job ${id} created for [${providerId}] -> ${operation}`
        }
      ],
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      _abortController: new AbortController()
    };

    this.jobs.set(id, job);
    this.saveToDisk();
    return job;
  }

  startJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = JOB_STATUS.RUNNING;
    job.startedAt = new Date().toISOString();
    this.appendLog(jobId, 'info', `Execution started.`);
  }

  updateProgress(jobId, progressPercent, message = null) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.progress = Math.min(100, Math.max(0, Math.round(progressPercent)));
    if (message) {
      this.appendLog(jobId, 'info', `Progress ${job.progress}%: ${message}`);
    }
  }

  appendLog(jobId, level, message) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level: level || 'info',
      message: String(message).trim()
    };
    job.logs.push(entry);
    if (job.logs.length > 500) {
      job.logs = job.logs.slice(-500);
    }
  }

  completeJob(jobId, result = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = JOB_STATUS.COMPLETED;
    job.progress = 100;
    job.result = result;
    job.completedAt = new Date().toISOString();
    this.appendLog(jobId, 'info', `Job completed successfully.`);
    this.saveToDisk();
    return job;
  }

  failJob(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = JOB_STATUS.FAILED;
    job.error = typeof error === 'object' ? (error.message || JSON.stringify(error)) : String(error);
    job.completedAt = new Date().toISOString();
    this.appendLog(jobId, 'error', `Job failed: ${job.error}`);
    this.saveToDisk();
    return job;
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED) {
      return false;
    }
    job.status = JOB_STATUS.CANCELLED;
    job.completedAt = new Date().toISOString();
    try {
      if (job._abortController) job._abortController.abort();
    } catch (_) {}
    this.appendLog(jobId, 'warn', `Job cancelled by operator.`);
    this.saveToDisk();
    return true;
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const { _abortController, ...cleanJob } = job;
    return cleanJob;
  }

  listJobs(filter = {}) {
    let list = Array.from(this.jobs.values()).map(j => {
      const { _abortController, ...clean } = j;
      return clean;
    });

    if (filter.providerId) {
      list = list.filter(j => j.providerId === filter.providerId);
    }
    if (filter.status) {
      list = list.filter(j => j.status === filter.status);
    }
    return list.reverse();
  }
}

module.exports = {
  IntegrationJobTracker,
  JOB_STATUS
};
