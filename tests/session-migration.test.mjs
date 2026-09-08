import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORRUPT_BACKUP_KEY,
  activeSessionStorageKey,
  backupCorruptData,
  createLegacyAiDataMigration,
  legacyChatStorageKey,
  legacyMemoryStorageKey,
  sessionsStorageKey
} from '../public/modules/ai/session/migration.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    has(key) { return map.has(key); },
    value(key) { return map.get(key); }
  };
}

function makeHarness({ storageSeed = {}, remote = null, readError = null } = {}) {
  const storage = memoryStorage(storageSeed);
  const writes = [];
  const warnings = [];
  const corrupt = [];
  const repository = {
    async read() {
      if (readError) throw readError;
      return remote;
    },
    write(bookId, payload) {
      writes.push({ bookId, payload });
      return Promise.resolve();
    }
  };
  let id = 0;
  const migration = createLegacyAiDataMigration({
    storage,
    repository,
    makeSession: () => ({ id: 's' + (++id), title: '新对话', messages: [] }),
    titleFromMessages: messages => 'T:' + messages[0].content,
    normalizeMemory: value => ({ ...value, normalized: true }),
    emptyMemory: () => ({ turns: [], rollups: [], rolledUpCount: 0 }),
    onWarning: (code, error, meta) => warnings.push({ code, message: error?.message, meta }),
    onCorruptSessions: event => corrupt.push(event)
  });
  return { storage, writes, warnings, corrupt, migration };
}

test('legacy storage key helpers preserve the existing key format', () => {
  assert.equal(sessionsStorageKey(7), 'wbe-sessions:7');
  assert.equal(activeSessionStorageKey(7), 'wbe-active-session:7');
  assert.equal(legacyChatStorageKey(7), 'wbe-chat:7');
  assert.equal(legacyMemoryStorageKey(7), 'wbe-memory:7');
  assert.equal(sessionsStorageKey(null), 'wbe-sessions:unsaved');
});

test('remote sessions win and do not touch local legacy data', async () => {
  const h = makeHarness({
    remote: { sessions: [{ id: 'remote' }], activeSession: 'remote' },
    storageSeed: { [sessionsStorageKey(1)]: JSON.stringify([{ id: 'local' }]) }
  });
  const result = await h.migration.loadSessionSeed(1);
  assert.deepEqual(result, { sessions: [{ id: 'remote' }], activeSession: 'remote', source: 'remote' });
  assert.equal(h.storage.has(sessionsStorageKey(1)), true);
  assert.equal(h.writes.length, 0);
});

test('modern local session list migrates to repository then clears all session legacy keys', async () => {
  const local = [{ id: 'local', messages: [] }];
  const h = makeHarness({
    storageSeed: {
      [sessionsStorageKey(2)]: JSON.stringify(local),
      [activeSessionStorageKey(2)]: 'local',
      [legacyChatStorageKey(2)]: JSON.stringify([{ role: 'user', content: 'old' }])
    }
  });
  const result = await h.migration.loadSessionSeed(2);
  assert.equal(result.source, 'local');
  assert.deepEqual(result.sessions, local);
  assert.equal(result.activeSession, 'local');
  assert.deepEqual(h.writes, [{ bookId: 2, payload: { sessions: local, activeSession: 'local' } }]);
  assert.equal(h.storage.has(sessionsStorageKey(2)), false);
  assert.equal(h.storage.has(activeSessionStorageKey(2)), false);
  assert.equal(h.storage.has(legacyChatStorageKey(2)), false);
});

test('single-session wbe-chat data is wrapped in a new session and titled', async () => {
  const old = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'world' }];
  const h = makeHarness({ storageSeed: { [legacyChatStorageKey(3)]: JSON.stringify(old) } });
  const result = await h.migration.loadSessionSeed(3);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, 's1');
  assert.deepEqual(result.sessions[0].messages, old);
  assert.equal(result.sessions[0].title, 'T:hello');
  assert.equal(h.writes.length, 1);
});

test('corrupt modern session data is backed up before falling back', async () => {
  const raw = '{bad json';
  const h = makeHarness({ storageSeed: { [sessionsStorageKey(4)]: raw } });
  const result = await h.migration.loadSessionSeed(4);
  assert.equal(result.source, 'empty');
  assert.equal(h.corrupt.length, 1);
  const backup = JSON.parse(h.storage.value(CORRUPT_BACKUP_KEY));
  assert.equal(backup[sessionsStorageKey(4)], raw);
  assert.equal(h.warnings[0].code, 'sessions_local_corrupt');
});

test('corrupt legacy single-session data is skipped without corrupt-backup side effect', async () => {
  const h = makeHarness({ storageSeed: { [legacyChatStorageKey(5)]: '{bad' } });
  const result = await h.migration.loadSessionSeed(5);
  assert.equal(result.source, 'empty');
  assert.equal(h.storage.has(CORRUPT_BACKUP_KEY), false);
  assert.ok(h.warnings.some(item => item.code === 'legacy_chat_corrupt'));
});

test('remote load failure falls back to local sessions and reports a warning', async () => {
  const local = [{ id: 'fallback' }];
  const h = makeHarness({
    readError: new Error('offline'),
    storageSeed: { [sessionsStorageKey(6)]: JSON.stringify(local) }
  });
  const result = await h.migration.loadSessionSeed(6);
  assert.deepEqual(result.sessions, local);
  assert.ok(h.warnings.some(item => item.code === 'session_remote_load_failed'));
});

test('legacy remote book-level memory wins, is normalized, and queues clearing old slot', async () => {
  const h = makeHarness({ remote: { memory: { turns: [{ user: 'x' }] } } });
  const result = await h.migration.migrateLegacyMemory(7);
  assert.equal(result.normalized, true);
  assert.deepEqual(h.writes, [{ bookId: 7, payload: { memory: null } }]);
});

test('legacy local memory migrates and removes its storage key', async () => {
  const key = legacyMemoryStorageKey(8);
  const h = makeHarness({ storageSeed: { [key]: JSON.stringify({ rollups: [{ text: 'old' }] }) } });
  const result = await h.migration.migrateLegacyMemory(8);
  assert.equal(result.normalized, true);
  assert.equal(h.storage.has(key), false);
});

test('invalid local memory is retained and falls back to empty memory', async () => {
  const key = legacyMemoryStorageKey(9);
  const h = makeHarness({ storageSeed: { [key]: '{bad' } });
  const result = await h.migration.migrateLegacyMemory(9);
  assert.deepEqual(result, { turns: [], rollups: [], rolledUpCount: 0 });
  assert.equal(h.storage.has(key), true);
  assert.ok(h.warnings.some(item => item.code === 'memory_local_migration_failed'));
});

test('cleanupBookLocalData removes all four legacy per-book keys', () => {
  const id = 10;
  const keys = [sessionsStorageKey(id), activeSessionStorageKey(id), legacyChatStorageKey(id), legacyMemoryStorageKey(id)];
  const h = makeHarness({ storageSeed: Object.fromEntries(keys.map(key => [key, 'x'])) });
  h.migration.cleanupBookLocalData(id);
  for (const key of keys) assert.equal(h.storage.has(key), false);
});

test('backupCorruptData caps one corrupt payload at 500000 characters and survives a broken prior backup', () => {
  const storage = memoryStorage({ [CORRUPT_BACKUP_KEY]: '{bad' });
  const ok = backupCorruptData(storage, 'broken', 'x'.repeat(500100));
  assert.equal(ok, true);
  const backup = JSON.parse(storage.value(CORRUPT_BACKUP_KEY));
  assert.equal(backup.broken.length, 500000);
});
