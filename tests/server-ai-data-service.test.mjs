import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDatabase } = require('../server/database.js');
const { createAiDataService, isValidBookId, parseJsonOrNull } = require('../server/ai-data-service.js');

function withDb(fn) {
  const db = createDatabase({ dbPath: ':memory:' });
  try { return fn(db); } finally { db.close(); }
}

test('book id and JSON helpers preserve current permissive read behavior', () => {
  assert.equal(isValidBookId('1'), true);
  assert.equal(isValidBookId('01'), true);
  assert.equal(isValidBookId(9), true);
  assert.equal(isValidBookId(''), false);
  assert.equal(isValidBookId('-1'), false);
  assert.equal(isValidBookId('1.2'), false);
  assert.equal(isValidBookId('abc'), false);
  assert.deepEqual(parseJsonOrNull('{"x":1}'), { x: 1 });
  assert.equal(parseJsonOrNull(null), null);
  assert.equal(parseJsonOrNull(''), null);
  assert.equal(parseJsonOrNull('{broken'), null);
});

test('get returns empty shape for invalid/missing books and tolerates corrupt persisted JSON', () => withDb(db => {
  const service = createAiDataService({ db });
  const empty = { memory: null, sessions: null, activeSession: null };
  assert.deepEqual(service.get('bad'), empty);
  assert.deepEqual(service.get('42'), empty);

  db.prepare('INSERT INTO ai_data (book_id, memory, sessions, active_session) VALUES (?, ?, ?, ?)')
    .run(42, '{broken', JSON.stringify([{ id: 's1' }]), 'active-1');
  assert.deepEqual(service.get('42'), {
    memory: null,
    sessions: [{ id: 's1' }],
    activeSession: 'active-1'
  });
}));

test('update rejects invalid ids and empty partial updates', () => withDb(db => {
  const service = createAiDataService({ db });
  assert.deepEqual(service.update('bad', { memory: {} }), { error: 'invalid_book_id' });
  assert.deepEqual(service.update('1', {}), { error: 'no_fields' });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ai_data').get().c, 0);
}));

test('partial upsert serializes JSON, stringifies activeSession and preserves omitted fields', () => withDb(db => {
  const service = createAiDataService({ db });
  assert.deepEqual(service.update('7', {
    memory: { summary: 'hello' },
    sessions: [{ id: 1 }],
    activeSession: 0
  }), { ok: true });

  let row = db.prepare('SELECT memory, sessions, active_session, updated_at FROM ai_data WHERE book_id = ?').get(7);
  assert.equal(row.memory, JSON.stringify({ summary: 'hello' }));
  assert.equal(row.sessions, JSON.stringify([{ id: 1 }]));
  assert.equal(row.active_session, '0');
  assert.ok(row.updated_at);

  assert.deepEqual(service.update('7', { memory: { summary: 'next' } }), { ok: true });
  row = db.prepare('SELECT memory, sessions, active_session FROM ai_data WHERE book_id = ?').get(7);
  assert.equal(row.memory, JSON.stringify({ summary: 'next' }));
  assert.equal(row.sessions, JSON.stringify([{ id: 1 }]));
  assert.equal(row.active_session, '0');
  assert.deepEqual(service.get(7), {
    memory: { summary: 'next' },
    sessions: [{ id: 1 }],
    activeSession: '0'
  });
}));

test('explicit nulls persist as SQL null without clearing omitted columns', () => withDb(db => {
  const service = createAiDataService({ db });
  service.update('3', {
    memory: { x: 1 },
    sessions: [{ id: 'keep' }],
    activeSession: 'keep'
  });
  assert.deepEqual(service.update('3', { memory: null, activeSession: null }), { ok: true });

  const row = db.prepare('SELECT memory, sessions, active_session FROM ai_data WHERE book_id = ?').get(3);
  assert.equal(row.memory, null);
  assert.equal(row.sessions, JSON.stringify([{ id: 'keep' }]));
  assert.equal(row.active_session, null);
  assert.deepEqual(service.get(3), {
    memory: null,
    sessions: [{ id: 'keep' }],
    activeSession: null
  });
}));
