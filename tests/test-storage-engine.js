/**
 * Storage Engine Test Suite
 * Tests SQLiteAdapter, DurableFileAdapter, Schema Migrations & Transaction Rollback.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { StorageManager, SQLiteAdapter, DurableFileAdapter } = require('../services/storage');

async function runStorageTests() {
  console.log('\n================================================================');
  console.log('💾 RUNNING STORAGE ENGINE & DURABLE PERSISTENCE TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  const testDataDir = path.join(__dirname, '../data/test-storage-' + Date.now());
  const migrationsDir = path.join(__dirname, '../migrations');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: DurableFileAdapter Atomic Persistence & Mutations
    // -------------------------------------------------------------------------
    total++;
    console.log('[TEST 1] Testing DurableFileAdapter Atomic Operations...');
    const fileAdapter = new DurableFileAdapter({ dataDir: testDataDir });
    await fileAdapter.connect();
    await fileAdapter.migrate(migrationsDir);

    const testMachine = {
      id: 'node_alpha_1',
      hostname: 'alpha-vps-test',
      os: 'Linux',
      arch: 'x86_64',
      status: 'online',
      virtual_ip: '10.77.0.10'
    };

    await fileAdapter.set('machines', testMachine.id, testMachine);
    const readBack = await fileAdapter.get('machines', testMachine.id);
    assert.deepStrictEqual(readBack, testMachine, 'Stored machine must match read back');

    const listed = await fileAdapter.list('machines', { status: 'online' });
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].hostname, 'alpha-vps-test');

    await fileAdapter.close();
    console.log('  ✅ DurableFileAdapter CRUD and multi-collection persistence verified!');
    passed++;

    // -------------------------------------------------------------------------
    // TEST 2: DurableFileAdapter Backup Recovery from Corrupted File
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 2] Testing DurableFileAdapter Corruption Recovery via .bak...');
    const stateFile = path.join(testDataDir, 'server-state.json');
    const backupFile = `${stateFile}.bak`;

    assert.ok(fs.existsSync(stateFile), 'State file must exist');
    assert.ok(fs.existsSync(backupFile), 'Backup file must exist');

    // Corrupt primary file with garbage text
    fs.writeFileSync(stateFile, 'CORRUPTED_GARBAGE_DATA_12345', 'utf8');

    const recoveringAdapter = new DurableFileAdapter({ dataDir: testDataDir });
    await recoveringAdapter.connect();
    const recoveredNode = await recoveringAdapter.get('machines', testMachine.id);
    assert.ok(recoveredNode, 'Must successfully recover node from backup');
    assert.strictEqual(recoveredNode.hostname, 'alpha-vps-test');
    await recoveringAdapter.close();
    console.log('  ✅ Automatic recovery from corrupted primary file via .bak verified!');
    passed++;

    // -------------------------------------------------------------------------
    // TEST 3: SQLiteAdapter Native WAL Mode & Schema Migrations
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 3] Testing SQLiteAdapter Native WAL & Schema Migrations...');
    const sqliteAdapter = new SQLiteAdapter({ dataDir: testDataDir });
    await sqliteAdapter.connect();
    const migRes = await sqliteAdapter.migrate(migrationsDir);
    assert.ok(migRes.applied >= 2, 'Must apply at least 2 migrations');

    const testNodeSqlite = {
      id: 'node_sqlite_1',
      hostname: 'sqlite-vps-test',
      username: 'root',
      os: 'Windows',
      os_version: 'Windows Server 2025',
      arch: 'AMD64',
      status: 'online',
      virtual_ip: '10.77.0.22',
      capabilities: ['rdp', 'powershell', 'port_bridge'],
      profile: { cpu_cores: 8, ram_gb: 32 }
    };

    await sqliteAdapter.set('machines', testNodeSqlite.id, testNodeSqlite);
    const readSqlite = await sqliteAdapter.get('machines', testNodeSqlite.id);
    assert.strictEqual(readSqlite.hostname, 'sqlite-vps-test');
    assert.strictEqual(readSqlite.os, 'Windows');
    assert.deepStrictEqual(readSqlite.capabilities, testNodeSqlite.capabilities);
    assert.deepStrictEqual(readSqlite.profile, testNodeSqlite.profile);
    console.log('  ✅ SQLiteAdapter schema migrations and JSON serialization verified!');
    passed++;

    // -------------------------------------------------------------------------
    // TEST 4: SQLite Transaction Atomicity & Rollback
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 4] Testing SQLite Transaction Atomicity & Rollback...');
    try {
      await sqliteAdapter.transaction(async (tx) => {
        await tx.set('machines', 'node_temp_rollback', {
          id: 'node_temp_rollback',
          hostname: 'rollback-node',
          os: 'Linux',
          arch: 'arm64'
        });
        throw new Error('Simulated transactional failure');
      });
      assert.fail('Transaction should have thrown');
    } catch (e) {
      assert.strictEqual(e.message, 'Simulated transactional failure');
    }

    const checkRollback = await sqliteAdapter.get('machines', 'node_temp_rollback');
    assert.strictEqual(checkRollback, null, 'Rolled back record must NOT exist in database');
    await sqliteAdapter.close();
    console.log('  ✅ Transaction rollback verified (zero leaked records)!');
    passed++;

    // -------------------------------------------------------------------------
    // TEST 5: StorageManager Factory Auto-Detection
    // -------------------------------------------------------------------------
    total++;
    console.log('\n[TEST 5] Testing StorageManager Factory Auto-Selection...');
    const managedStorage = await StorageManager.create({ dataDir: testDataDir, migrationsDir });
    assert.ok(managedStorage.connected, 'Managed storage must be connected');
    const health = await managedStorage.healthCheck();
    assert.strictEqual(health.connected, true);
    console.log(`  Activated driver: ${health.type}`);
    await managedStorage.close();
    console.log('  ✅ StorageManager auto-detection and initialization verified!');
    passed++;

  } finally {
    // Clean up test data directory
    try {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passed}/${total} STORAGE ENGINE TESTS PASSED!`);
  console.log('================================================================\n');
}

runStorageTests().catch(err => {
  console.error('\n❌ STORAGE TEST FAILED:', err);
  process.exit(1);
});
