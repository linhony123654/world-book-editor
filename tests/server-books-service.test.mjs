import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDatabase } = require('../server/database.js');
const { createBooksService, isValidBookData, entryCountOf } = require('../server/books-service.js');

function book(entries = {}, extra = {}) {
  return { entries, ...extra };
}

function entry(uid, comment, content = '') {
  return { uid, comment, content, key: [] };
}

function withDb(fn) {
  const db = createDatabase({ dbPath: ':memory:' });
  try { return fn(db); } finally { db.close(); }
}

test('book data validation and entry counts preserve existing truthy entries contract', () => {
  assert.equal(isValidBookData(null), false);
  assert.equal(isValidBookData({}), false);
  assert.equal(isValidBookData({ entries: {} }), true);
  assert.equal(entryCountOf({ entries: { 1: {}, 2: {} } }), 2);
});

test('snapshotVersion skips identical latest data and trims only old auto versions', () => withDb(db => {
  const service = createBooksService({ db, maxAutoVersions: 2 });
  const a = book({ 1: entry(1, 'A') });
  const b = book({ 1: entry(1, 'B') });
  const c = book({ 1: entry(1, 'C') });
  const d = book({ 1: entry(1, 'D') });

  assert.equal(service.snapshotVersion(7, a, 1, 'auto', ''), true);
  assert.equal(service.snapshotVersion(7, a, 1, 'auto', ''), false);
  assert.equal(service.snapshotVersion(7, b, 1, 'auto', ''), true);
  assert.equal(service.snapshotVersion(7, c, 1, 'manual', 'pin'), true);
  assert.equal(service.snapshotVersion(7, d, 1, 'auto', ''), true);

  const rows = db.prepare('SELECT kind, note, data FROM book_versions WHERE book_id = ? ORDER BY id').all(7);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter(row => row.kind === 'auto').length, 2);
  assert.equal(rows.filter(row => row.kind === 'manual').length, 1);
  assert.equal(rows.some(row => row.note === 'pin'), true);
  assert.equal(rows.some(row => JSON.parse(row.data).entries['1'].comment === 'A'), false);
}));

test('version list exposes first three comments and tolerates corrupt historical JSON', () => withDb(db => {
  const service = createBooksService({ db });
  const data = book({
    1: entry(1, 'Alpha'),
    2: entry(2, ''),
    3: entry(3, 'Gamma'),
    4: entry(4, 'Delta')
  });
  service.snapshotVersion(1, data, 4, 'manual', 'ok');
  db.prepare("INSERT INTO book_versions (book_id, data, entry_count, kind, note) VALUES (?, ?, ?, ?, ?)")
    .run(1, '{broken', 0, 'manual', 'broken');

  const list = service.listVersions(1);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0].titles, []);
  assert.deepEqual(list[1].titles, ['Alpha', '(无标题)', 'Gamma']);
  assert.equal(Object.prototype.hasOwnProperty.call(list[1], 'data'), false);
}));

test('getVersion returns parsed data and null for missing versions', () => withDb(db => {
  const service = createBooksService({ db });
  const data = book({ 1: entry(1, 'Lore') });
  service.snapshotVersion(3, data, 1, 'manual', 'checkpoint');
  const id = db.prepare('SELECT id FROM book_versions WHERE book_id = 3').get().id;
  const version = service.getVersion(3, id);
  assert.equal(version.id, id);
  assert.deepEqual(version.data, data);
  assert.equal(version.entry_count, 1);
  assert.equal(version.kind, 'manual');
  assert.equal(version.note, 'checkpoint');
  assert.equal(service.getVersion(3, 999), null);
}));

test('rollbackVersion snapshots current data before restoring the selected version', () => withDb(db => {
  const service = createBooksService({ db });
  const oldData = book({ 1: entry(1, 'Old') });
  const currentData = book({ 1: entry(1, 'Current'), 2: entry(2, 'Extra') });
  const created = service.createBook('Lore', currentData);
  service.snapshotVersion(created.id, oldData, 1, 'manual', 'target');
  const versionId = db.prepare("SELECT id FROM book_versions WHERE book_id = ? AND note = 'target'").get(created.id).id;

  const result = service.rollbackVersion(created.id, versionId);
  assert.deepEqual(result, { entry_count: 1 });
  assert.deepEqual(service.getBook(created.id).data, oldData);

  const backup = db.prepare("SELECT data, note FROM book_versions WHERE book_id = ? AND note = '回滚前快照'").get(created.id);
  assert.ok(backup);
  assert.deepEqual(JSON.parse(backup.data), currentData);
  assert.equal(service.rollbackVersion(created.id, 99999), null);
}));

test('book CRUD preserves default name, parsed payloads and optimistic conflict contract', () => withDb(db => {
  const service = createBooksService({ db });
  assert.deepEqual(service.createBook('bad', null), { error: 'invalid_data' });

  const initial = book({ 1: entry(1, 'A') });
  const created = service.createBook('', initial);
  assert.equal(created.entry_count, 1);
  assert.equal(service.getBook(created.id).name, 'untitled');
  assert.equal(service.listBooks().length, 1);
  assert.equal(service.getBook(999), null);

  const before = service.getBook(created.id);
  assert.deepEqual(service.updateBook(999, { data: initial }), { error: 'not_found' });
  assert.deepEqual(service.updateBook(created.id, { data: null }), { error: 'invalid_data' });
  assert.deepEqual(service.updateBook(created.id, { data: initial, baseUpdatedAt: 'different' }), {
    error: 'conflict', serverUpdatedAt: before.updated_at
  });

  const next = book({ 1: entry(1, 'B'), 2: entry(2, 'C') });
  const updated = service.updateBook(created.id, { data: next, name: 'Renamed', baseUpdatedAt: 'different', force: true });
  assert.equal(updated.ok, true);
  assert.equal(updated.entry_count, 2);
  assert.equal(service.getBook(created.id).name, 'Renamed');
  assert.deepEqual(service.getBook(created.id).data, next);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM book_versions WHERE book_id = ?').get(created.id).c, 1);
}));

test('deleteBook writes a sanitized backup, trims backups, and returns false when missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wbe-delete-'));
  const db = createDatabase({ dbPath: ':memory:' });
  try {
    const service = createBooksService({ db, rootDir: root, deletedBackupLimit: 2 });
    const created = service.createBook('Bad / Name:*?', book({ 1: entry(1, 'A') }));
    const dir = path.join(root, 'backups', 'deleted');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '000-old.json'), '{}');
    fs.writeFileSync(path.join(dir, '001-old.json'), '{}');

    assert.equal(service.deleteBook(created.id), true);
    assert.equal(service.getBook(created.id), null);
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort();
    assert.equal(files.length, 2);
    assert.equal(files.some(file => /Bad_Name/.test(file)), true);
    assert.equal(service.deleteBook(999), false);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('delete backup failures are logged but do not block deletion', () => withDb(db => {
  const errors = [];
  const fsImpl = {
    mkdirSync() { throw new Error('disk full'); },
    readdirSync() { return []; },
    writeFileSync() {},
    unlinkSync() {}
  };
  const service = createBooksService({ db, fsImpl, logger: { error: (...args) => errors.push(args), log() {} } });
  const created = service.createBook('Lore', book({ 1: entry(1, 'A') }));
  assert.equal(service.deleteBook(created.id), true);
  assert.equal(service.getBook(created.id), null);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], '[WBE] 删除备份失败:');
}));

test('sample seeding runs only for an empty database and keeps sample.json naming', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wbe-sample-'));
  const db = createDatabase({ dbPath: ':memory:' });
  const logs = [];
  try {
    fs.writeFileSync(path.join(root, 'sample.json'), JSON.stringify(book({ 1: entry(1, 'Seed') })));
    const service = createBooksService({ db, rootDir: root, logger: { log: (...args) => logs.push(args), error() {} } });
    assert.equal(service.seedSampleIfEmpty(), true);
    assert.equal(service.seedSampleIfEmpty(), false);
    const rows = service.listBooks();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'sample.json');
    assert.equal(rows[0].entry_count, 1);
    assert.equal(logs.length, 1);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
