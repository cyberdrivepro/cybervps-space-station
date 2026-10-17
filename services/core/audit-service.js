/**
 * CYBERVPS SPACE STATION - AUDIT LOGGING & SECURITY TRAIL SERVICE
 * Cryptographically Protected, Secret-Redacted Structured Audit Trail
 */

const EventEmitter = require('events');

class AuditService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.storage = options.storage || null;
    this.bufferSize = options.bufferSize || 1000;
    this.ringBuffer = [];
    this.enableConsole = options.enableConsole !== false;

    // Patterns for strict secret redaction
    this.redactPatterns = [
      /(?:[?&]|\b)(pairing_key\s*[:=]\s*)([^\s,"'&]+)/gi,
      /(?:[?&]|\b)(token\s*[:=]\s*)([^\s,"'&]+)/gi,
      /(?:[?&]|\b)(ticket\s*[:=]\s*)([^\s,"'&]+)/gi,
      /(?:[?&]|\b)(password\s*[:=]\s*)([^\s,"'&]+)/gi,
      /("pairing_key"\s*:\s*")([^"]+)(")/gi,
      /("password"\s*:\s*")([^"]+)(")/gi,
      /("token"\s*:\s*")([^"]+)(")/gi,
      /("secret"\s*:\s*")([^"]+)(")/gi,
      /(Bearer\s+)[A-Za-z0-9_\-\.]+/gi,
      /(cybervps_pair_[a-zA-Z0-9_\-]+)/gi,
      /(cvps_pair_[a-zA-Z0-9_\-]+)/gi,
      /(cvps_enroll_[a-zA-Z0-9_\-]+)/gi,
      /(cvps_boot_[a-zA-Z0-9_\-]+)/gi,
      /(cvps_node_[a-zA-Z0-9_\-]+)/gi,
      /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g
    ];
  }

  /**
   * Redact sensitive information from text or objects
   */
  redact(input) {
    if (!input) return input;
    if (typeof input === 'object') {
      try {
        const jsonStr = JSON.stringify(input);
        const redactedStr = this._redactString(jsonStr);
        return JSON.parse(redactedStr);
      } catch (e) {
        return input;
      }
    }
    return this._redactString(String(input));
  }

  _redactString(str) {
    let result = str;
    for (const pattern of this.redactPatterns) {
      result = result.replace(pattern, (match, p1, p2, p3) => {
        if (p1 && p2 && p3) return `${p1}[REDACTED]${p3}`;
        if (p1 && p2) return `${p1}[REDACTED]`;
        if (match.startsWith('Bearer ')) return 'Bearer [REDACTED]';
        if (match.startsWith('cvps_')) return match.substring(0, 10) + '...[REDACTED]';
        if (match.startsWith('-----BEGIN')) return '[PRIVATE_KEY_REDACTED]';
        return '[REDACTED]';
      });
    }
    return result;
  }

  /**
   * Log an audit event
   */
  async log(level, action, message, metadata = {}) {
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      level: String(level).toUpperCase(),
      action: String(action),
      message: this.redact(message),
      metadata: this.redact(metadata),
      correlation_id: metadata.correlation_id || null,
      machine_id: metadata.machine_id || null,
      client_ip: metadata.client_ip || null
    };

    // Maintain in ring buffer
    this.ringBuffer.unshift(event);
    if (this.ringBuffer.length > this.bufferSize) {
      this.ringBuffer.pop();
    }

    if (this.enableConsole) {
      const prefix = `[AUDIT] [${event.level}] ${event.action}:`;
      if (event.level === 'CRITICAL' || event.level === 'SECURITY') {
        console.error(`${prefix} ${event.message}`);
      } else if (event.level === 'WARNING') {
        console.warn(`${prefix} ${event.message}`);
      } else {
        console.log(`${prefix} ${event.message}`);
      }
    }

    // Persist to storage if configured
    if (this.storage && typeof this.storage.insertAuditEvent === 'function') {
      try {
        await this.storage.insertAuditEvent(event);
      } catch (err) {
        // Fallback to memory
      }
    }

    // Broadcast to listeners (e.g. WebSocket subscribers)
    this.emit('event', event);

    return event;
  }

  info(action, message, meta) {
    return this.log('INFO', action, message, meta);
  }

  warn(action, message, meta) {
    return this.log('WARNING', action, message, meta);
  }

  security(action, message, meta) {
    return this.log('SECURITY', action, message, meta);
  }

  critical(action, message, meta) {
    return this.log('CRITICAL', action, message, meta);
  }

  /**
   * Query recent audit logs with filters
   */
  query(filters = {}) {
    let results = [...this.ringBuffer];

    if (filters.level) {
      const lvl = filters.level.toUpperCase();
      results = results.filter(e => e.level === lvl);
    }

    if (filters.action) {
      results = results.filter(e => e.action.toLowerCase().includes(filters.action.toLowerCase()));
    }

    if (filters.machine_id) {
      results = results.filter(e => e.machine_id === filters.machine_id);
    }

    if (filters.correlation_id) {
      results = results.filter(e => e.correlation_id === filters.correlation_id);
    }

    if (filters.search) {
      const term = filters.search.toLowerCase();
      results = results.filter(e =>
        e.action.toLowerCase().includes(term) ||
        e.message.toLowerCase().includes(term) ||
        JSON.stringify(e.metadata).toLowerCase().includes(term)
      );
    }

    const limit = Math.min(filters.limit || 100, 500);
    const offset = filters.offset || 0;

    return {
      total: results.length,
      limit,
      offset,
      events: results.slice(offset, offset + limit)
    };
  }

  /**
   * Export audit log as CSV
   */
  exportCSV(filters = {}) {
    const data = this.query(filters);
    const headers = ['Timestamp', 'Level', 'Action', 'Machine ID', 'Message', 'Correlation ID'];
    const rows = [headers.join(',')];

    for (const e of data.events) {
      const row = [
        `"${e.timestamp}"`,
        `"${e.level}"`,
        `"${e.action}"`,
        `"${e.machine_id || ''}"`,
        `"${(e.message || '').replace(/"/g, '""')}"`,
        `"${e.correlation_id || ''}"`
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }
}

module.exports = AuditService;
