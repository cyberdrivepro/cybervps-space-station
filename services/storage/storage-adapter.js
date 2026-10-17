/**
 * StorageAdapter - Abstract Base Class for CyberVPS Durable Persistence
 * Defines standardized CRUD, transactions, key-value and query capabilities.
 */

class StorageAdapter {
  constructor(options = {}) {
    this.options = options;
    this.connected = false;
  }

  async connect() {
    throw new Error('StorageAdapter.connect() must be implemented by subclass');
  }

  async close() {
    throw new Error('StorageAdapter.close() must be implemented by subclass');
  }

  async migrate(migrationsDir) {
    throw new Error('StorageAdapter.migrate() must be implemented by subclass');
  }

  // Key-Value style access (e.g. for configs, simple maps)
  async get(collection, key) {
    throw new Error('StorageAdapter.get() must be implemented by subclass');
  }

  async set(collection, key, value) {
    throw new Error('StorageAdapter.set() must be implemented by subclass');
  }

  async delete(collection, key) {
    throw new Error('StorageAdapter.delete() must be implemented by subclass');
  }

  async list(collection, filter = {}) {
    throw new Error('StorageAdapter.list() must be implemented by subclass');
  }

  // Transaction execution
  async transaction(fn) {
    throw new Error('StorageAdapter.transaction() must be implemented by subclass');
  }

  // Health and metrics
  async healthCheck() {
    return {
      connected: this.connected,
      type: this.constructor.name,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { StorageAdapter };
