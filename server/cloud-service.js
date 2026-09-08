const fs = require('fs');
const path = require('path');

const DEFAULT_REMOTE_PATH = 'world-books-backup.json';
const CLOUD_BUNDLE_FORMAT = 'wbe-cloud-bundle';
const CLOUD_BUNDLE_VERSION = 1;
const CLOUD_VERSION_LIMIT = 5;
const PRE_RESTORE_BACKUP_LIMIT = 10;

function createCloudService({
  db,
  rootDir,
  transports,
  fsImpl = fs,
  pathImpl = path,
  now = () => new Date(),
  logger = console
} = {}) {
  if (!db) throw new TypeError('Cloud service requires db');
  if (!rootDir) throw new TypeError('Cloud service requires rootDir');
  if (!transports) throw new TypeError('Cloud service requires transports');

  function getConfig() {
    return db.prepare('SELECT * FROM cloud_config WHERE id = 1').get() || null;
  }

  function saveConfig(cfg) {
    const columns = [
      'provider', 'webdav_url', 'webdav_user', 'webdav_pass',
      's3_endpoint', 's3_region', 's3_bucket', 's3_access_key', 's3_secret_key',
      'remote_path', 'updated_at'
    ];
    const keys = columns.filter(column => column !== 'updated_at' && cfg[column] !== undefined);
    const placeholders = keys.map(() => '?');
    const updates = keys.map(column => column + ' = excluded.' + column);
    db.prepare(`INSERT INTO cloud_config (id, ${keys.join(', ')}, updated_at) VALUES (1, ${placeholders.join(', ')}, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}, updated_at = excluded.updated_at`)
      .run(...keys.map(column => cfg[column]));
  }

  function configure(body = {}) {
    const provider = body.provider === 's3' ? 's3' : 'webdav';
    const cfg = { provider };
    if (provider === 's3') {
      cfg.s3_endpoint = String(body.s3_endpoint || '').trim();
      cfg.s3_region = String(body.s3_region || 'us-east-1').trim();
      cfg.s3_bucket = String(body.s3_bucket || '').trim();
      cfg.s3_access_key = String(body.s3_access_key || '').trim();
      cfg.s3_secret_key = String(body.s3_secret_key || '').trim();
    } else {
      cfg.webdav_url = String(body.webdav_url || '').trim();
      cfg.webdav_user = String(body.webdav_user || '').trim();
      cfg.webdav_pass = String(body.webdav_pass || '');
    }
    cfg.remote_path = String(body.remote_path || DEFAULT_REMOTE_PATH).trim().replace(/^\/+/, '') || DEFAULT_REMOTE_PATH;
    saveConfig(cfg);
    return { ok: true };
  }

  function buildBundle() {
    const books = db.prepare('SELECT id, name, data, entry_count FROM world_books ORDER BY id').all();
    const aiData = db.prepare('SELECT book_id, memory, sessions, active_session FROM ai_data ORDER BY book_id').all();
    return {
      format: CLOUD_BUNDLE_FORMAT,
      version: CLOUD_BUNDLE_VERSION,
      exportedAt: now().toISOString(),
      books: books.map(book => ({
        id: book.id,
        name: book.name,
        entry_count: book.entry_count,
        data: JSON.parse(book.data)
      })),
      aiData: aiData.map(row => ({
        book_id: row.book_id,
        memory: row.memory == null ? null : JSON.parse(row.memory),
        sessions: row.sessions == null ? null : JSON.parse(row.sessions),
        active_session: row.active_session
      }))
    };
  }

  function backupPreRestore() {
    try {
      const dir = pathImpl.join(rootDir, 'backups', 'cloud');
      fsImpl.mkdirSync(dir, { recursive: true });
      const timestamp = now().toISOString().replace(/[:.]/g, '-');
      fsImpl.writeFileSync(pathImpl.join(dir, timestamp + '-pre-restore.json'), JSON.stringify(buildBundle()));
      const files = fsImpl.readdirSync(dir).filter(file => file.endsWith('.json')).sort();
      while (files.length > PRE_RESTORE_BACKUP_LIMIT) {
        fsImpl.unlinkSync(pathImpl.join(dir, files.shift()));
      }
    } catch (error) {
      logger.error('[WBE] 恢复前备份失败:', error.message);
    }
  }

  function restoreBundle(bundle) {
    if (!bundle || bundle.format !== CLOUD_BUNDLE_FORMAT || !Array.isArray(bundle.books)) {
      throw new Error('不是有效的云端备份文件');
    }
    backupPreRestore();
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM world_books').run();
      db.prepare('DELETE FROM ai_data').run();
      const insertBook = db.prepare('INSERT INTO world_books (id, name, data, entry_count) VALUES (?, ?, ?, ?)');
      const insertAi = db.prepare('INSERT INTO ai_data (book_id, memory, sessions, active_session) VALUES (?, ?, ?, ?)');
      for (const book of bundle.books) {
        const entryCount = Number.isInteger(book.entry_count)
          ? book.entry_count
          : Object.keys((book.data && book.data.entries) || {}).length;
        insertBook.run(
          book.id,
          String(book.name || '未命名'),
          JSON.stringify(book.data || { entries: {} }),
          entryCount
        );
      }
      for (const row of bundle.aiData || []) {
        insertAi.run(
          row.book_id,
          row.memory == null ? null : JSON.stringify(row.memory),
          row.sessions == null ? null : JSON.stringify(row.sessions),
          row.active_session || null
        );
      }
    });
    transaction();
    return { books: bundle.books.length, ai: (bundle.aiData || []).length };
  }

  function versionPathFor(cfg, timestamp) {
    const remotePath = String(cfg.remote_path || DEFAULT_REMOTE_PATH).replace(/^\/+/, '');
    const dot = remotePath.lastIndexOf('.');
    return (dot > 0 ? remotePath.slice(0, dot) : remotePath)
      + '-' + timestamp
      + (dot > 0 ? remotePath.slice(dot) : '');
  }

  async function testConnection() {
    const cfg = getConfig();
    if (!cfg) return { error: 'not_configured' };
    return transports.testConnection(cfg);
  }

  async function upload() {
    const cfg = getConfig();
    if (!cfg) return { error: 'not_configured' };
    const bundleObject = buildBundle();
    const bundle = JSON.stringify(bundleObject);
    const timestamp = now().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/g, '').slice(0, 15);
    const mainPath = String(cfg.remote_path || DEFAULT_REMOTE_PATH).replace(/^\/+/, '');
    const action = transports.action(cfg);
    await action.upload(mainPath, bundle);
    const versionPath = versionPathFor(cfg, timestamp);
    await action.upload(versionPath, bundle);
    db.prepare('INSERT INTO cloud_versions (path) VALUES (?)').run(versionPath);
    db.prepare('DELETE FROM cloud_versions WHERE id NOT IN (SELECT id FROM cloud_versions ORDER BY id DESC LIMIT 5)').run();
    saveConfig({ ...cfg, updated_at: now().toISOString() });
    return {
      ok: true,
      books: bundleObject.books.length,
      exportedAt: bundleObject.exportedAt,
      versionPath
    };
  }

  function listVersions() {
    return db.prepare('SELECT path, uploaded_at FROM cloud_versions ORDER BY id DESC LIMIT 5').all();
  }

  async function download(versionPath) {
    const cfg = getConfig();
    if (!cfg) return { error: 'not_configured' };
    const text = await transports.action(cfg).download(versionPath);
    let bundle;
    try {
      bundle = JSON.parse(text);
    } catch {
      throw new Error('云端文件不是有效 JSON');
    }
    const stats = restoreBundle(bundle);
    return { ok: true, ...stats, exportedAt: bundle.exportedAt || null };
  }

  return {
    getConfig,
    saveConfig,
    configure,
    buildBundle,
    backupPreRestore,
    restoreBundle,
    versionPathFor,
    testConnection,
    upload,
    listVersions,
    download
  };
}

module.exports = {
  CLOUD_BUNDLE_FORMAT,
  CLOUD_BUNDLE_VERSION,
  CLOUD_VERSION_LIMIT,
  DEFAULT_REMOTE_PATH,
  PRE_RESTORE_BACKUP_LIMIT,
  createCloudService
};
