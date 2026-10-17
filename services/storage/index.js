/**
 * StorageManager - Unified Storage Gateway for CyberVPS Space Station
 * Selects the optimal storage driver based on runtime environment:
 * 1. PostgresAdapter (if DATABASE_URL is provided in cloud/enterprise environment)
 * 2. SQLiteAdapter (if node:sqlite is natively available in Node runtime)
 * 3. DurableFileAdapter (zero-dependency atomic file persistence fallback)
 */

const path = require('path');
const { DurableFileAdapter } = require('./durable-file-adapter');
const { SQLiteAdapter } = require('./sqlite-adapter');
const { PostgresAdapter } = require('./postgres-adapter');

class StorageManager {
  static async create(options = {}) {
    const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '../../data');
    const migrationsDir = options.migrationsDir || path.join(__dirname, '../../migrations');

    let adapter = null;

    // 1. Try PostgreSQL if DATABASE_URL is configured
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
      try {
        const pg = new PostgresAdapter({ connectionString: process.env.DATABASE_URL });
        await pg.connect();
        adapter = pg;
        console.log('[StorageManager] Activated PostgreSQL production database adapter.');
      } catch (err) {
        console.warn(`[StorageManager] PostgreSQL connection failed (${err.message}). Falling back...`);
      }
    }

    // 2. Try native SQLite
    if (!adapter) {
      try {
        const sqlite = new SQLiteAdapter({ dataDir });
        await sqlite.connect();
        adapter = sqlite;
        console.log('[StorageManager] Activated native SQLite (WAL mode) database adapter.');
      } catch (err) {
        console.warn(`[StorageManager] SQLite initialization skipped (${err.message}). Falling back to DurableFile...`);
      }
    }

    // 3. Fallback to DurableFileAdapter
    if (!adapter) {
      adapter = new DurableFileAdapter({ dataDir });
      await adapter.connect();
      console.log('[StorageManager] Activated DurableFile atomic JSON storage adapter.');
    }

    // Execute schema migrations automatically
    try {
      const migRes = await adapter.migrate(migrationsDir);
      console.log(`[StorageManager] Migrations verified (${migRes.applied} migrations applied/checked).`);
    } catch (migErr) {
      console.warn(`[StorageManager] Migration warning: ${migErr.message}`);
    }

    return adapter;
  }
}

module.exports = {
  StorageManager,
  DurableFileAdapter,
  SQLiteAdapter,
  PostgresAdapter
};
