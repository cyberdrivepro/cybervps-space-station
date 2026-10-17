/**
 * PostgresAdapter - PostgreSQL Durable Storage Adapter for CyberVPS Enterprise Deployments
 * Automatically activates when process.env.DATABASE_URL is provided (e.g. Railway Postgres, Supabase).
 * Falls back gracefully to SQLite/File storage if pg client is not installed or connection fails.
 */

const fs = require('fs');
const path = require('path');
const { StorageAdapter } = require('./storage-adapter');

class PostgresAdapter extends StorageAdapter {
  constructor(options = {}) {
    super(options);
    this.connectionString = options.connectionString || process.env.DATABASE_URL;
    this.pool = null;
  }

  async connect() {
    if (!this.connectionString) {
      throw new Error('PostgresAdapter requires DATABASE_URL connection string.');
    }
    let pg = null;
    try {
      pg = require('pg');
    } catch (_) {
      throw new Error('The "pg" npm module is required for PostgresAdapter.');
    }
    const { Pool } = pg;
    this.pool = new Pool({
      connectionString: this.connectionString,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
    // Test connectivity
    const client = await this.pool.connect();
    client.release();
    this.connected = true;
    return true;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.connected = false;
  }

  async migrate(migrationsDir) {
    if (!this.pool) await this.connect();
    
    await this.pool.query(`
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
      const check = await this.pool.query('SELECT version FROM schema_migrations WHERE version = $1', [version]);
      if (check.rows.length === 0) {
        const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
        const client = await this.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version, description) VALUES ($1, $2)', [version, `Applied migration ${f}`]);
          await client.query('COMMIT');
          applied++;
        } catch (err) {
          await client.query('ROLLBACK');
          client.release();
          throw err;
        } finally {
          client.release();
        }
      }
    }
    return { applied, status: 'synced' };
  }

  async get(collection, key) {
    if (!this.pool) await this.connect();
    const cleanCol = this._sanitizeName(collection);
    const res = await this.pool.query(`SELECT * FROM ${cleanCol} WHERE id = $1`, [String(key)]);
    return res.rows[0] ? this._deserializeRow(res.rows[0]) : null;
  }

  async set(collection, key, value) {
    if (!this.pool) await this.connect();
    const cleanCol = this._sanitizeName(collection);
    const data = { ...value, id: String(key) };
    const serialized = this._serializeRow(data);

    const keys = Object.keys(serialized);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const updates = keys.map(k => `${k} = EXCLUDED.${k}`).join(', ');

    const sql = `
      INSERT INTO ${cleanCol} (${keys.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${updates};
    `;

    await this.pool.query(sql, Object.values(serialized));
    return true;
  }

  async delete(collection, key) {
    if (!this.pool) await this.connect();
    const cleanCol = this._sanitizeName(collection);
    const res = await this.pool.query(`DELETE FROM ${cleanCol} WHERE id = $1`, [String(key)]);
    return (res.rowCount || 0) > 0;
  }

  async list(collection, filter = {}) {
    if (!this.pool) await this.connect();
    const cleanCol = this._sanitizeName(collection);
    const filterKeys = Object.keys(filter);
    
    let sql = `SELECT * FROM ${cleanCol}`;
    const values = [];

    if (filterKeys.length > 0) {
      const clauses = filterKeys.map((k, i) => `${this._sanitizeName(k)} = $${i + 1}`);
      sql += ` WHERE ${clauses.join(' AND ')}`;
      for (const k of filterKeys) values.push(filter[k]);
    }

    const res = await this.pool.query(sql, values);
    return res.rows.map(r => this._deserializeRow(r));
  }

  async transaction(fn) {
    if (!this.pool) await this.connect();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await fn({
        get: (col, key) => client.query(`SELECT * FROM ${this._sanitizeName(col)} WHERE id = $1`, [String(key)]),
        set: (col, key, val) => this.set(col, key, val)
      });
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  _sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '');
  }

  _serializeRow(row) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) {
        out[k] = null;
      } else if (typeof v === 'object') {
        out[k] = JSON.stringify(v);
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

module.exports = { PostgresAdapter };
