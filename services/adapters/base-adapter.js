/**
 * CyberVPS Space Station - Base Integration Adapter
 * Abstract foundation for all third-party open-source provider adapters.
 * Enforces consistent lifecycle states, secret protection, error handling,
 * and audited operation dispatch.
 */

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const ADAPTER_STATUS = {
  NOT_CONFIGURED: 'not_configured',
  UNCONFIGURED: 'unconfigured', // backwards compatible alias
  CONFIGURED_UNCHECKED: 'configured_unchecked',
  CONNECTED: 'connected',
  DEGRADED: 'degraded',
  DISCONNECTED: 'disconnected',
  BINARY_MISSING: 'binary_missing',
  UNAUTHORIZED: 'unauthorized',
  BLOCKED: 'blocked'
};

class BaseAdapter {
  /**
   * @param {Object} options
   * @param {string} options.id - Provider unique identifier (e.g. 'netbird', 'frp')
   * @param {string} options.name - Human-readable provider name
   * @param {string} options.category - networking | tunnels | remote_access | paas | backup | security | observability | infrastructure | provisioning | supply_chain
   * @param {string} options.description - Detailed description of capabilities
   * @param {string} options.version - Compatible provider API / binary version
   * @param {Array<string>} options.supportedOperations - List of operations this provider can execute
   * @param {Object} [options.config] - Initial configuration
   */
  constructor(options = {}) {
    if (!options.id) throw new Error('Adapter id is required');
    this.id = options.id;
    this.name = options.name || options.id;
    this.category = options.category || 'general';
    this.description = options.description || '';
    this.version = options.version || '1.0.0';
    this.supportedOperations = options.supportedOperations || [];
    
    this.status = ADAPTER_STATUS.UNCONFIGURED;
    this.lastSync = null;
    this.lastError = null;
    this.lastLatencyMs = null;
    this.config = options.config || {};
    this.metrics = {
      operationsRun: 0,
      failures: 0,
      lastOperationAt: null
    };
  }

  /**
   * Determine if the adapter has sufficient configuration to attempt a connection
   * @returns {boolean}
   */
  isConfigured() {
    return false;
  }

  /**
   * Test live connectivity to the upstream service or executable.
   * Must return { success: boolean, status: string, latency_ms?: number, details?: any, error?: string }
   */
  async testConnection() {
    throw new Error(`testConnection() not implemented for ${this.id}`);
  }

  /**
   * Execute a supported operation
   * @param {string} operation
   * @param {Object} params
   * @param {Object} [jobContext] - Optional JobTracker context for progress / logs
   */
  async executeOperation(operation, params = {}, jobContext = null) {
    if (!this.supportedOperations.includes(operation)) {
      throw new Error(`Operation '${operation}' is not supported by provider '${this.id}'. Supported: ${this.supportedOperations.join(', ')}`);
    }
    this.metrics.operationsRun++;
    this.metrics.lastOperationAt = new Date().toISOString();
  }

  /**
   * Update configuration and persist
   */
  updateConfig(newConfig = {}) {
    // Preserve existing sensitive values if user passed '***' placeholder
    const merged = { ...this.config };
    for (const [key, val] of Object.entries(newConfig)) {
      if (typeof val === 'string' && val.startsWith('***') && merged[key]) {
        // Keep existing secret
        continue;
      }
      merged[key] = val;
    }
    this.config = merged;
    if (this.isConfigured()) {
      this.status = this.lastSync ? this.status : ADAPTER_STATUS.CONFIGURED_UNCHECKED;
    } else {
      this.status = ADAPTER_STATUS.NOT_CONFIGURED;
    }
    return this.getSanitizedConfig();
  }

  /**
   * Return configuration safe for frontend transmission (all secrets masked)
   */
  getSanitizedConfig() {
    const sensitiveKeys = ['token', 'password', 'secret', 'key', 'api_key', 'private_key', 'auth_token', 'credentials', 'cert', 'passphrase'];
    const sanitized = {};
    for (const [k, v] of Object.entries(this.config)) {
      const lower = k.toLowerCase();
      const isSensitive = sensitiveKeys.some(sk => lower.includes(sk));
      if (isSensitive && v) {
        const strVal = String(v);
        sanitized[k] = strVal.length > 8
          ? `${strVal.slice(0, 3)}***${strVal.slice(-3)}`
          : '***';
        sanitized[`${k}_is_set`] = true;
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  /**
   * Get complete status summary object
   */
  getStatus() {
    let resolvedStatus = this.status;
    if (!this.isConfigured()) {
      resolvedStatus = ADAPTER_STATUS.NOT_CONFIGURED;
    } else if (resolvedStatus === ADAPTER_STATUS.UNCONFIGURED || resolvedStatus === ADAPTER_STATUS.NOT_CONFIGURED) {
      resolvedStatus = ADAPTER_STATUS.CONFIGURED_UNCHECKED;
    }

    return {
      id: this.id,
      name: this.name,
      category: this.category,
      description: this.description,
      version: this.version,
      status: resolvedStatus,
      configured: this.isConfigured(),
      lastSync: this.lastSync,
      lastError: this.lastError,
      lastLatencyMs: this.lastLatencyMs,
      supportedOperations: this.supportedOperations,
      metrics: this.metrics
    };
  }

  /**
   * Helper: Make HTTP/HTTPS request with timeout and error handling
   */
  httpRequest(urlStr, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(urlStr);
        const client = parsed.protocol === 'https:' ? https : http;
        const port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);
        const timeoutMs = options.timeout || 8000;
        const t0 = Date.now();

        const reqOptions = {
          hostname: parsed.hostname,
          port: port,
          path: parsed.pathname + parsed.search,
          method: options.method || 'GET',
          headers: options.headers || {},
          timeout: timeoutMs,
          rejectUnauthorized: options.rejectUnauthorized !== false
        };

        const req = client.request(reqOptions, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            const latencyMs = Date.now() - t0;
            let json = null;
            try {
              json = JSON.parse(body);
            } catch (_) {}
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body,
              json,
              latencyMs
            });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`HTTP request timed out after ${timeoutMs}ms: ${urlStr}`));
        });

        req.on('error', (err) => {
          reject(new Error(`HTTP request error: ${err.message}`));
        });

        if (options.body) {
          const sendData = typeof options.body === 'object' ? JSON.stringify(options.body) : options.body;
          req.write(sendData);
        }
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Helper: Run executable with safe argument array (strictly avoiding shell string injection)
   */
  runSubprocess(command, args = [], options = {}) {
    return new Promise((resolve) => {
      const timeoutMs = options.timeout || 30000;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      let child;
      try {
        child = spawn(command, args, {
          cwd: options.cwd || process.cwd(),
          env: options.env || process.env,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (err) {
        return resolve({
          code: -1,
          stdout: '',
          stderr: err.message,
          error: err.message
        });
      }

      if (options.stdin) {
        try {
          child.stdin.write(options.stdin);
          child.stdin.end();
        } catch (_) {}
      }

      child.stdout.on('data', (d) => {
        const text = d.toString('utf8');
        stdout += text;
        if (options.onLog) options.onLog('stdout', text);
      });

      child.stderr.on('data', (d) => {
        const text = d.toString('utf8');
        stderr += text;
        if (options.onLog) options.onLog('stderr', text);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch (_) {}
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          code: timedOut ? -2 : code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          code: -1,
          stdout: stdout.trim(),
          stderr: err.message,
          error: err.message
        });
      });
    });
  }
}

module.exports = {
  BaseAdapter,
  ADAPTER_STATUS
};
