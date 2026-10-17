/**
 * FileManager - Remote SFTP & Host File RPC Service
 * Handles:
 * - Cross-platform path validation & path traversal defense (../ and null bytes)
 * - Safe directory listing, file reading, writing, renaming, and atomic deletion
 * - MIME type detection & text vs binary format classification
 * - Host RPC dispatching across authenticated agent WebSocket bridge
 */

const path = require('path');

class FileManager {
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB max file buffer
    this.forbiddenRoots = new Set(['/', '\\', 'C:\\', 'C:/', '/bin', '/sbin', '/etc', '/boot', '/sys', '/proc']);
  }

  /**
   * Sanitizes and validates a requested remote path to prevent path traversal attacks.
   */
  sanitizePath(rawPath, rootDir = null) {
    if (!rawPath || typeof rawPath !== 'string') {
      return rootDir || '/';
    }

    // 1. Block null byte attacks
    if (rawPath.indexOf('\0') !== -1) {
      throw new Error('Path validation failed: Null byte character detected.');
    }

    // 2. Block direct traversal sequences
    if (rawPath.includes('../') || rawPath.includes('..\\') || rawPath.startsWith('..')) {
      if (rootDir) {
        const resolvedRoot = path.resolve(rootDir);
        const resolvedTarget = path.resolve(rootDir, rawPath);
        if (!resolvedTarget.startsWith(resolvedRoot)) {
          throw new Error('Path validation failed: Directory traversal sequence blocked.');
        }
      } else {
        throw new Error('Path validation failed: Directory traversal sequence blocked.');
      }
    }

    // 3. Normalize path and resolve .. segments
    let clean = path.normalize(rawPath.trim());

    // 4. If rootDir is provided, ensure resolved path stays inside rootDir
    if (rootDir) {
      const resolvedRoot = path.resolve(rootDir);
      const resolvedTarget = path.resolve(resolvedRoot, clean);
      if (!resolvedTarget.startsWith(resolvedRoot)) {
        throw new Error('Path validation failed: Directory traversal outside root directory.');
      }
      return resolvedTarget;
    }

    if (clean.startsWith('..') || clean.includes('/../') || clean.includes('\\..\\')) {
      throw new Error('Path validation failed: Directory traversal sequence blocked.');
    }

    return clean;
  }

  /**
   * Verifies that a delete or overwrite operation is not targeting critical OS root files.
   */
  assertSafeMutation(targetPath) {
    const clean = this.sanitizePath(targetPath);
    if (this.forbiddenRoots.has(clean) || this.forbiddenRoots.has(clean.toUpperCase())) {
      throw new Error(`Permission denied: Mutation of system root [${clean}] is strictly prohibited.`);
    }
    return true;
  }

  /**
   * Formats directory entry items with permissions, size, and icons.
   */
  formatListing(entries = []) {
    return entries.map(item => ({
      name: item.name,
      path: item.path,
      is_dir: Boolean(item.is_dir || item.type === 'directory'),
      size_bytes: parseInt(item.size, 10) || 0,
      size_formatted: this._formatBytes(item.size || 0),
      modified_at: item.modified_at || item.mtime || new Date().toISOString(),
      permissions: item.permissions || (item.is_dir ? 'drwxr-xr-x' : '-rw-r--r--'),
      mime_type: item.is_dir ? 'directory' : this._detectMimeType(item.name)
    })).sort((a, b) => {
      // Directories first, then alphabetical
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Dispatches file operation RPC to enrolled agent.
   */
  async executeAgentRpc(agentWs, action, params = {}, timeoutMs = 8000) {
    if (!agentWs || agentWs.readyState !== 1) { // 1 = OPEN
      throw new Error('Host agent is offline or WebSocket connection is closed.');
    }

    const reqId = 'rpc_' + Math.random().toString(36).substring(2, 10);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`File RPC '${action}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const onMessage = (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'FileRpcResponse' && msg.req_id === reqId) {
            cleanup();
            if (msg.error) {
              reject(new Error(msg.error));
            } else {
              resolve(msg.result);
            }
          }
        } catch (_) {}
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (agentWs.removeListener) {
          agentWs.removeListener('message', onMessage);
        }
      };

      if (agentWs.on) {
        agentWs.on('message', onMessage);
      }

      agentWs.send(JSON.stringify({
        type: 'FileRpc',
        req_id: reqId,
        action,
        params
      }));
    });
  }

  _formatBytes(bytes) {
    const b = parseInt(bytes, 10) || 0;
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  _detectMimeType(filename = '') {
    const ext = path.extname(filename).toLowerCase();
    const map = {
      '.txt': 'text/plain',
      '.log': 'text/plain',
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.py': 'text/x-python',
      '.sh': 'text/x-shellscript',
      '.ps1': 'text/x-powershell',
      '.html': 'text/html',
      '.css': 'text/css',
      '.md': 'text/markdown',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip'
    };
    return map[ext] || 'application/octet-stream';
  }
}

module.exports = { FileManager };
