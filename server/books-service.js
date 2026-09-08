const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_AUTO_VERSIONS = 30;
const DEFAULT_VERSION_LIST_LIMIT = 50;
const DEFAULT_DELETED_BACKUP_LIMIT = 20;

function isValidBookData(data) {
  return Boolean(data && data.entries);
}

function entryCountOf(data) {
  return Object.keys(data.entries).length;
}

function createBooksService({
  db,
  fsImpl = fs,
  pathImpl = path,
  rootDir = path.join(__dirname, '..'),
  maxAutoVersions = DEFAULT_MAX_AUTO_VERSIONS,
  deletedBackupLimit = DEFAULT_DELETED_BACKUP_LIMIT,
  logger = console
} = {}) {
  if (!db) throw new TypeError('Books service requires db');

  function snapshotVersion(bookId, data, entryCount, kind, note) {
    const latest = db.prepare('SELECT data FROM book_versions WHERE book_id = ? ORDER BY id DESC LIMIT 1').get(bookId);
    const json = JSON.stringify(data);
    if (latest && latest.data === json) return false;

    db.prepare('INSERT INTO book_versions (book_id, data, entry_count, kind, note) VALUES (?, ?, ?, ?, ?)')
      .run(bookId, json, entryCount, kind || 'auto', note || '');

    const autos = db.prepare('SELECT id FROM book_versions WHERE book_id = ? AND kind = ? ORDER BY id DESC').all(bookId, 'auto');
    if (autos.length > maxAutoVersions) {
      const keep = new Set(autos.slice(0, maxAutoVersions).map(row => row.id));
      const remove = autos.filter(row => !keep.has(row.id)).map(row => row.id);
      if (remove.length) db.prepare('DELETE FROM book_versions WHERE id IN (' + remove.join(',') + ')').run();
    }
    return true;
  }

  function listVersions(bookId, limit = DEFAULT_VERSION_LIST_LIMIT) {
    const rows = db.prepare('SELECT id, entry_count, kind, note, data, created_at FROM book_versions WHERE book_id = ? ORDER BY id DESC LIMIT ?')
      .all(bookId, limit);
    return rows.map(row => {
      let titles = [];
      try {
        const data = JSON.parse(row.data);
        titles = Object.values(data.entries || {}).slice(0, 3).map(entry => String(entry.comment || '(无标题)'));
      } catch {}
      return {
        id: row.id,
        entry_count: row.entry_count,
        kind: row.kind,
        note: row.note,
        created_at: row.created_at,
        titles
      };
    });
  }

  function getVersion(bookId, versionId) {
    const row = db.prepare('SELECT * FROM book_versions WHERE id = ? AND book_id = ?').get(versionId, bookId);
    if (!row) return null;
    return {
      id: row.id,
      data: JSON.parse(row.data),
      entry_count: row.entry_count,
      kind: row.kind,
      note: row.note,
      created_at: row.created_at
    };
  }

  function rollbackVersion(bookId, versionId) {
    const row = db.prepare('SELECT * FROM book_versions WHERE id = ? AND book_id = ?').get(versionId, bookId);
    if (!row) return null;

    const current = db.prepare('SELECT data FROM world_books WHERE id = ?').get(bookId);
    if (current) {
      const currentData = JSON.parse(current.data);
      snapshotVersion(bookId, currentData, Object.keys(currentData.entries || {}).length, 'auto', '回滚前快照');
    }

    const data = JSON.parse(row.data);
    const entryCount = Object.keys(data.entries || {}).length;
    db.prepare("UPDATE world_books SET data = ?, entry_count = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(data), entryCount, bookId);
    return { entry_count: entryCount };
  }

  function listBooks() {
    return db.prepare('SELECT id, name, entry_count, created_at, updated_at FROM world_books ORDER BY updated_at DESC').all();
  }

  function getBook(bookId) {
    const row = db.prepare('SELECT * FROM world_books WHERE id = ?').get(bookId);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      data: JSON.parse(row.data),
      entry_count: row.entry_count,
      updated_at: row.updated_at
    };
  }

  function createBook(name, data) {
    if (!isValidBookData(data)) return { error: 'invalid_data' };
    const entryCount = entryCountOf(data);
    const result = db.prepare('INSERT INTO world_books (name, data, entry_count) VALUES (?, ?, ?)')
      .run(name || 'untitled', JSON.stringify(data), entryCount);
    return { id: result.lastInsertRowid, entry_count: entryCount };
  }

  function updateBook(bookId, { data, name, baseUpdatedAt, force } = {}) {
    const existing = db.prepare('SELECT id, updated_at FROM world_books WHERE id = ?').get(bookId);
    if (!existing) return { error: 'not_found' };
    if (!isValidBookData(data)) return { error: 'invalid_data' };
    if (!force && baseUpdatedAt && existing.updated_at !== baseUpdatedAt) {
      return { error: 'conflict', serverUpdatedAt: existing.updated_at };
    }

    const entryCount = entryCountOf(data);
    const updates = [];
    const params = [];
    if (name) {
      updates.push('name = ?');
      params.push(name);
    }
    updates.push('data = ?', 'entry_count = ?', "updated_at = datetime('now')");
    params.push(JSON.stringify(data), entryCount, bookId);
    db.prepare(`UPDATE world_books SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    snapshotVersion(bookId, data, entryCount, 'auto', '');
    const row = db.prepare('SELECT updated_at FROM world_books WHERE id = ?').get(bookId);
    return { ok: true, entry_count: entryCount, updated_at: row.updated_at };
  }

  function backupDeletedBook(row) {
    try {
      const dir = pathImpl.join(rootDir, 'backups', 'deleted');
      fsImpl.mkdirSync(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const safeName = String(row.name || 'book').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
      fsImpl.writeFileSync(pathImpl.join(dir, ts + '-' + row.id + '-' + safeName + '.json'), row.data);
      const files = fsImpl.readdirSync(dir).filter(file => file.endsWith('.json')).sort();
      while (files.length > deletedBackupLimit) fsImpl.unlinkSync(pathImpl.join(dir, files.shift()));
      return true;
    } catch (error) {
      logger.error('[WBE] 删除备份失败:', error.message);
      return false;
    }
  }

  function deleteBook(bookId) {
    const row = db.prepare('SELECT id, name, data FROM world_books WHERE id = ?').get(bookId);
    if (!row) return false;
    backupDeletedBook(row);
    db.prepare('DELETE FROM world_books WHERE id = ?').run(bookId);
    return true;
  }

  function seedSampleIfEmpty() {
    const count = db.prepare('SELECT COUNT(*) as c FROM world_books').get().c;
    if (count !== 0) return false;
    const samplePath = pathImpl.join(rootDir, 'sample.json');
    if (!fsImpl.existsSync(samplePath)) return false;
    const data = JSON.parse(fsImpl.readFileSync(samplePath, 'utf8'));
    const entryCount = Object.keys(data.entries).length;
    db.prepare('INSERT INTO world_books (name, data, entry_count) VALUES (?, ?, ?)')
      .run('sample.json', JSON.stringify(data), entryCount);
    logger.log('[WBE] Imported sample.json (' + entryCount + ' entries)');
    return true;
  }

  return {
    backupDeletedBook,
    createBook,
    deleteBook,
    getBook,
    getVersion,
    listBooks,
    listVersions,
    rollbackVersion,
    seedSampleIfEmpty,
    snapshotVersion,
    updateBook
  };
}

module.exports = {
  DEFAULT_DELETED_BACKUP_LIMIT,
  DEFAULT_MAX_AUTO_VERSIONS,
  DEFAULT_VERSION_LIST_LIMIT,
  createBooksService,
  entryCountOf,
  isValidBookData
};
