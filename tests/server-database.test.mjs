import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SCHEMA_SQL, createDatabase, resolveDatabasePath } = require('../server/database.js');

test('database path keeps WBE_DB override and world-books.db default', () => {
  assert.equal(resolveDatabasePath({ env: { WBE_DB: '/tmp/custom.db' }, rootDir: '/repo' }), '/tmp/custom.db');
  assert.equal(resolveDatabasePath({ env: {}, rootDir: '/repo' }), path.join('/repo', 'world-books.db'));
});

test('schema registry preserves all current persistent tables', () => {
  for (const table of ['world_books', 'users', 'sessions', 'ai_data', 'cloud_config', 'cloud_versions', 'book_versions']) {
    assert.match(SCHEMA_SQL, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
});

test('database bootstrap creates the current schema in an isolated database', () => {
  const db = createDatabase({ dbPath: ':memory:' });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    for (const table of ['world_books', 'users', 'sessions', 'ai_data', 'cloud_config', 'cloud_versions', 'book_versions']) {
      assert.ok(tables.includes(table), `missing ${table}`);
    }
    const worldBookColumns = db.prepare('PRAGMA table_info(world_books)').all().map(row => row.name);
    assert.deepEqual(worldBookColumns, ['id', 'name', 'data', 'entry_count', 'created_at', 'updated_at']);
    const versionColumns = db.prepare('PRAGMA table_info(book_versions)').all().map(row => row.name);
    assert.deepEqual(versionColumns, ['id', 'book_id', 'data', 'entry_count', 'kind', 'note', 'created_at']);
  } finally {
    db.close();
  }
});
