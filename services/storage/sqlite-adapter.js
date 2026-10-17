/**
 * SQLiteAdapter - Native SQLite Durable Storage for CyberVPS Space Station
 * Powered by node:sqlite DatabaseSync (zero external npm dependencies required).
 * Provides:
 * - WAL (Write-Ahead Logging) mode for extreme concurrency & durability
 * - Transactional execution (BEGIN / COMMIT / ROLLBACK)
 * - Prepared statement caching
 * - Automated SQL schema migration execution
 */

const fs = require('fs');
const path = require('path');
const { StorageAdapter } = require('./storage-adapter');

let DatabaseSync = null;
try {
  const sqlite = require('node:sqlite');
  DatabaseSync = sqlite.DatabaseSync;
} catch (_) {}

class SQLiteAdapter extends StorageAdapter {
  constructor(options = {}) {
    super(options);
    this.dataDir = options.dataDir || path.join(__dirname, '../../data');
    this.dbPath = options.dbPath || path.join(this.dataDir, 'cybervps-station.db');
    this.db = null;
    this.stmtCache = new Map();
  }

  async connect() {
    if (!DatabaseSync) {
      throw new Error('node:sqlite DatabaseSync is not supported on this Node.js runtime.');
    }
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    // Enable WAL mode & foreign keys
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.connected = true;
    return true;
  }

  async close() {
    if (this.db) {
      this.stmtCache.clear();
      this.db.close();
      this.db = null;
    }
    this.connected = false;
  }

  async migrate(migrationsDir) {
    if (!this.db) await this.connect();
    
    // Ensure migrations tracker table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(64) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        description TEXT
      );
    `);

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let applied = 0;
    for (const f of files) {
      const version = f.replace(/\.sql$/, '');
      const checkStmt = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
      const row = checkStmt.get(version);
      if (!row) {
        const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
        this.db.exec('BEGIN TRANSACTION;');
        try {
          this.db.exec(sql);
          const insStmt = this.db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)');
          insStmt.run(version, `Applied migration ${f}`);
          this.db.exec('COMMIT;');
          applied++;
        } catch (err) {
          this.db.exec('ROLLBACK;');
          throw new Error(`Migration ${f} failed: ${err.message}`);
        }
      }
    }
    return { applied, status: 'synced' };
  }

  async get(collection, key) {
    if (!this.db) await this.connect();
    // Generalized collection query by primary key
    const stmt = this._getOrCreateStmt(`SELECT * FROM ${this._sanitizeName(collection)} WHERE id = ?`);
    const row = stmt.get(String(key));
    return row ? this._deserializeRow(row) : null;
  }

  _getTableColumns(tableName) {
    if (!this.tableCols) this.tableCols = new Map();
    if (!this.tableCols.has(tableName)) {
      try {
        const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
        const set = new Set(rows.map(r => r.name));
        this.tableCols.set(tableName, set);
      } catch (_) {
        return new Set();
      }
    }
    return this.tableCols.get(tableName);
  }

  _ensureColumns(tableName, keys) {
    const existing = this._getTableColumns(tableName);
    if (!existing || existing.size === 0) return;
    for (const k of keys) {
      if (!existing.has(k)) {
        try {
          this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${this._sanitizeName(k)} TEXT;`);
          existing.add(k);
        } catch (_) {}
      }
    }
  }

  async set(collection, key, value) {
    if (!this.db) await this.connect();
    const cleanCol = this._sanitizeName(collection);
    const data = { ...value, id: String(key) };
    const serialized = this._serializeRow(data);

    const keys = Object.keys(serialized);
    this._ensureColumns(cleanCol, keys);

    const placeholders = keys.map(() => '?').join(', ');
    const updates = keys.map(k => `${k} = excluded.${k}`).join(', ');

    const sql = `
      INSERT INTO ${cleanCol} (${keys.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${updates};
    `;

    const stmt = this.db.prepare(sql);
    stmt.run(...Object.values(serialized));
    return true;
  }

  async delete(collection, key) {
    if (!this.db) await this.connect();
    const stmt = this._getOrCreateStmt(`DELETE FROM ${this._sanitizeName(collection)} WHERE id = ?`);
    const res = stmt.run(String(key));
    return res.changes > 0;
  }

  async list(collection, filter = {}) {
    if (!this.db) await this.connect();
    const cleanCol = this._sanitizeName(collection);
    const filterKeys = Object.keys(filter);
    
    let sql = `SELECT * FROM ${cleanCol}`;
    const values = [];

    if (filterKeys.length > 0) {
      const clauses = filterKeys.map(k => `${this._sanitizeName(k)} = ?`);
      sql += ` WHERE ${clauses.join(' AND ')}`;
      for (const k of filterKeys) values.push(filter[k]);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values);
    return rows.map(r => this._deserializeRow(r));
  }

  async transaction(fn) {
    if (!this.db) await this.connect();
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const res = await fn(this);
      this.db.exec('COMMIT;');
      return res;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  _sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '');
  }

  _getOrCreateStmt(sql) {
    if (!this.stmtCache.has(sql)) {
      this.stmtCache.set(sql, this.db.prepare(sql));
    }
    return this.stmtCache.get(sql);
  }

  _serializeRow(row) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) {
        out[k] = null;
      } else if (typeof v === 'object') {
        out[k] = JSON.stringify(v);
      } else if (typeof v === 'boolean') {
        out[k] = v ? 1 : 0;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  _deserializeRow(row) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
        try {
          out[k] = JSON.parse(v);
          continue;
        } catch (_) {}
      }
      out[k] = v;
    }
    return out;
  }
}

module.exports = { SQLiteAdapter };
