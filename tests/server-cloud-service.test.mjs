import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDatabase } = require('../server/database.js');
const {
  CLOUD_BUNDLE_FORMAT,
  CLOUD_BUNDLE_VERSION,
  createCloudService
} = require('../server/cloud-service.js');

const FIXED_DATE = new Date('2026-01-02T03:04:05.000Z');

function fixture() {
  const db = createDatabase({ dbPath: ':memory:' });
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbe-cloud-'));
  const uploads = [];
  let downloadText = '';
  let testResult = { ok: true };
  const transports = {
    action(cfg) {
      return {
        async upload(objectPath, body) { uploads.push({ cfg, objectPath, body }); },
        async download(objectPath) { return typeof downloadText === 'function' ? downloadText(objectPath, cfg) : downloadText; }
      };
    },
    async testConnection(cfg) {
      return typeof testResult === 'function' ? testResult(cfg) : testResult;
    }
  };
  const service = createCloudService({
    db,
    rootDir,
    transports,
    now: () => FIXED_DATE,
    logger: { error() {} }
  });
  return {
    db,
    rootDir,
    uploads,
    service,
    setDownloadText(value) { downloadText = value; },
    setTestResult(value) { testResult = value; },
    cleanup() { db.close(); fs.rmSync(rootDir, { recursive: true, force: true }); }
  };
}

function seedBook(db, id = 1, name = 'Lore', data = { entries: { 1: { uid: 1, comment: 'A' } } }) {
  db.prepare('INSERT INTO world_books (id, name, data, entry_count) VALUES (?, ?, ?, ?)')
    .run(id, name, JSON.stringify(data), Object.keys(data.entries || {}).length);
}

test('configure preserves provider normalization, trimming and default remote path', () => {
  const fx = fixture();
  try {
    assert.equal(fx.service.getConfig(), null);
    assert.deepEqual(fx.service.configure({
      provider: 's3',
      s3_endpoint: ' https://s3.example.com/ ',
      s3_region: ' ',
      s3_bucket: ' bucket ',
      s3_access_key: ' key ',
      s3_secret_key: ' secret ',
      remote_path: ' /folder/main.json '
    }), { ok: true });
    const s3 = fx.service.getConfig();
    assert.equal(s3.provider, 's3');
    assert.equal(s3.s3_endpoint, 'https://s3.example.com/');
    assert.equal(s3.s3_region, '');
    assert.equal(s3.s3_bucket, 'bucket');
    assert.equal(s3.s3_access_key, 'key');
    assert.equal(s3.s3_secret_key, 'secret');
    assert.equal(s3.remote_path, 'folder/main.json');

    fx.service.configure({ provider: 'anything-else', webdav_url: ' https://dav.example.com ', webdav_pass: 123, remote_path: '///' });
    const webdav = fx.service.getConfig();
    assert.equal(webdav.provider, 'webdav');
    assert.equal(webdav.webdav_url, 'https://dav.example.com');
    assert.equal(webdav.webdav_pass, '123');
    assert.equal(webdav.remote_path, 'world-books-backup.json');
  } finally { fx.cleanup(); }
});

test('buildBundle preserves current book/AI payload shape and exportedAt', () => {
  const fx = fixture();
  try {
    seedBook(fx.db);
    fx.db.prepare('INSERT INTO ai_data (book_id, memory, sessions, active_session) VALUES (?, ?, ?, ?)')
      .run(1, JSON.stringify({ summary: 'm' }), JSON.stringify([{ id: 's' }]), 's');
    assert.deepEqual(fx.service.buildBundle(), {
      format: CLOUD_BUNDLE_FORMAT,
      version: CLOUD_BUNDLE_VERSION,
      exportedAt: FIXED_DATE.toISOString(),
      books: [{
        id: 1,
        name: 'Lore',
        entry_count: 1,
        data: { entries: { 1: { uid: 1, comment: 'A' } } }
      }],
      aiData: [{
        book_id: 1,
        memory: { summary: 'm' },
        sessions: [{ id: 's' }],
        active_session: 's'
      }]
    });
  } finally { fx.cleanup(); }
});

test('restoreBundle validates first, writes pre-restore backup, replaces books/AI transactionally and derives entry counts', () => {
  const fx = fixture();
  try {
    seedBook(fx.db, 1, 'Old');
    fx.db.prepare('INSERT INTO ai_data (book_id, memory) VALUES (?, ?)').run(1, JSON.stringify({ old: true }));
    assert.throws(() => fx.service.restoreBundle({ books: [] }), /不是有效的云端备份文件/);

    const stats = fx.service.restoreBundle({
      format: CLOUD_BUNDLE_FORMAT,
      version: 1,
      exportedAt: '2025-12-31T00:00:00.000Z',
      books: [
        { id: 10, name: '', data: { entries: { 2: { uid: 2 }, 3: { uid: 3 } } } },
        { id: 11, name: 'Explicit', entry_count: 9, data: { entries: {} } }
      ],
      aiData: [{ book_id: 10, memory: { m: 1 }, sessions: [{ id: 1 }], active_session: '' }]
    });
    assert.deepEqual(stats, { books: 2, ai: 1 });
    const books = fx.db.prepare('SELECT id, name, entry_count FROM world_books ORDER BY id').all();
    assert.deepEqual(books, [
      { id: 10, name: '未命名', entry_count: 2 },
      { id: 11, name: 'Explicit', entry_count: 9 }
    ]);
    const ai = fx.db.prepare('SELECT book_id, memory, sessions, active_session FROM ai_data').get();
    assert.equal(ai.book_id, 10);
    assert.equal(ai.memory, JSON.stringify({ m: 1 }));
    assert.equal(ai.sessions, JSON.stringify([{ id: 1 }]));
    assert.equal(ai.active_session, null);

    const backupDir = path.join(fx.rootDir, 'backups', 'cloud');
    const backups = fs.readdirSync(backupDir).filter(file => file.endsWith('.json'));
    assert.equal(backups.length, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(backupDir, backups[0]), 'utf8'));
    assert.equal(saved.books[0].name, 'Old');
  } finally { fx.cleanup(); }
});

test('pre-restore backups keep only the newest 10 JSON files', () => {
  const fx = fixture();
  try {
    seedBook(fx.db);
    const dir = path.join(fx.rootDir, 'backups', 'cloud');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 11; i++) fs.writeFileSync(path.join(dir, String(i).padStart(2, '0') + '.json'), '{}');
    fx.service.backupPreRestore();
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort();
    assert.equal(files.length, 10);
    assert.equal(files.includes('00.json'), false);
    assert.equal(files.includes('01.json'), false);
  } finally { fx.cleanup(); }
});

test('versionPathFor keeps extension placement and leading-slash normalization', () => {
  const fx = fixture();
  try {
    assert.equal(fx.service.versionPathFor({ remote_path: '/dir/main.json' }, '20260102T030405'), 'dir/main-20260102T030405.json');
    assert.equal(fx.service.versionPathFor({ remote_path: 'main' }, '20260102T030405'), 'main-20260102T030405');
  } finally { fx.cleanup(); }
});

test('test/upload/list versions preserve not-configured, double-upload and five-version retention contracts', async () => {
  const fx = fixture();
  try {
    assert.deepEqual(await fx.service.testConnection(), { error: 'not_configured' });
    assert.deepEqual(await fx.service.upload(), { error: 'not_configured' });
    fx.service.configure({ provider: 'webdav', webdav_url: 'https://dav.example.com', remote_path: '/dir/main.json' });
    seedBook(fx.db);
    for (let i = 0; i < 6; i++) fx.db.prepare('INSERT INTO cloud_versions (path) VALUES (?)').run('old-' + i + '.json');

    assert.deepEqual(await fx.service.testConnection(), { ok: true });
    const result = await fx.service.upload();
    assert.deepEqual(result, {
      ok: true,
      books: 1,
      exportedAt: FIXED_DATE.toISOString(),
      versionPath: 'dir/main-20260102T030405.json'
    });
    assert.equal(fx.uploads.length, 2);
    assert.equal(fx.uploads[0].objectPath, 'dir/main.json');
    assert.equal(fx.uploads[1].objectPath, 'dir/main-20260102T030405.json');
    assert.equal(JSON.parse(fx.uploads[0].body).format, CLOUD_BUNDLE_FORMAT);

    const versions = fx.service.listVersions();
    assert.equal(versions.length, 5);
    assert.equal(versions[0].path, 'dir/main-20260102T030405.json');
  } finally { fx.cleanup(); }
});

test('download defaults through transport, rejects invalid JSON and restores valid bundles', async () => {
  const fx = fixture();
  try {
    assert.deepEqual(await fx.service.download(), { error: 'not_configured' });
    fx.service.configure({ provider: 'webdav', webdav_url: 'https://dav.example.com' });
    fx.setDownloadText('not-json');
    await assert.rejects(() => fx.service.download(), /云端文件不是有效 JSON/);

    seedBook(fx.db, 1, 'Before');
    fx.setDownloadText(JSON.stringify({
      format: CLOUD_BUNDLE_FORMAT,
      version: 1,
      exportedAt: '2025-01-01T00:00:00.000Z',
      books: [{ id: 8, name: 'Restored', data: { entries: {} }, entry_count: 0 }],
      aiData: []
    }));
    assert.deepEqual(await fx.service.download('version.json'), {
      ok: true,
      books: 1,
      ai: 0,
      exportedAt: '2025-01-01T00:00:00.000Z'
    });
    assert.equal(fx.db.prepare('SELECT name FROM world_books').get().name, 'Restored');
  } finally { fx.cleanup(); }
});
