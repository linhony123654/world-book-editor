const Database = require('better-sqlite3');
const path = require('path');

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS world_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    entry_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_data (
    book_id INTEGER PRIMARY KEY,
    memory TEXT,
    sessions TEXT,
    active_session TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cloud_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL DEFAULT 'webdav',
    webdav_url TEXT, webdav_user TEXT, webdav_pass TEXT,
    s3_endpoint TEXT, s3_region TEXT, s3_bucket TEXT, s3_access_key TEXT, s3_secret_key TEXT,
    remote_path TEXT NOT NULL DEFAULT 'world-books-backup.json',
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cloud_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS book_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    entry_count INTEGER DEFAULT 0,
    kind TEXT DEFAULT 'auto',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`;

function resolveDatabasePath({ env = process.env, rootDir = path.join(__dirname, '..') } = {}) {
  return env.WBE_DB || path.join(rootDir, 'world-books.db');
}

function createDatabase({ dbPath = resolveDatabasePath(), DatabaseImpl = Database } = {}) {
  const db = new DatabaseImpl(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

module.exports = {
  SCHEMA_SQL,
  createDatabase,
  resolveDatabasePath
};
