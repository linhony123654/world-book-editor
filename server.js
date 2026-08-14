const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 8084;

app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));

// ===== 安全响应头 =====
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; '));
  next();
});

// 只暴露 public/ 下的前端文件；数据库/源码/依赖目录一律不可访问
// 缓存策略：index.html 与 ES 模块每次重新验证（no-cache + ETag，304 无 body 几乎零成本，部署立即可见）；
// 其余资源（app.js / style.css 等带 ?v= 版本号）缓存 1 小时
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.includes(path.sep + 'modules' + path.sep)) {
      res.set('Cache-Control', 'no-cache');
    } else {
      res.set('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// ===== SQLite =====
const db = new Database(process.env.WBE_DB || path.join(__dirname, 'world-books.db'));
db.pragma('journal_mode = WAL');
db.exec(`
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
`);

// ===== 认证：scrypt 密码哈希 + 30 天 token 会话 =====
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt:' + salt + ':' + hash;
}
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split(':');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(hash, 'hex'));
}
function hasUsers() { return db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0; }
function bearerToken(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }
function userForToken(token) {
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token) || null;
}
function createSession(userId) {
  // 顺手清理过期会话，防止 sessions 表无限增长
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`).run(token, userId);
  return token;
}
function authRequired(req, res, next) {
  const user = userForToken(bearerToken(req));
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

// ===== 登录限流：每 IP 15 分钟最多 20 次尝试 =====
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, firstAt: now };
  if (now - rec.firstAt > 15 * 60 * 1000) { rec.count = 0; rec.firstAt = now; }
  rec.count++;
  loginAttempts.set(ip, rec);
  if (rec.count > 20) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试' });
  next();
}
// 定期清理限流记录，防止 Map 无限增长
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [ip, rec] of loginAttempts) {
    if (rec.firstAt < cutoff) loginAttempts.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// ===== 认证 API =====
app.get('/api/auth-state', (req, res) => {
  res.json({ initialized: hasUsers() });
});
app.post('/api/setup', loginRateLimit, (req, res) => {
  if (hasUsers()) return res.status(403).json({ error: 'already initialized' });
  const username = String((req.body || {}).username || '').trim();
  const password = String((req.body || {}).password || '');
  if (!username || username.length < 2 || password.length < 6) {
    return res.status(400).json({ error: '用户名至少 2 位，密码至少 6 位' });
  }
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
  const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  const token = createSession(user.id);
  res.json({ token, username: user.username });
});
app.post('/api/login', loginRateLimit, (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  const password = String((req.body || {}).password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = createSession(user.id);
  res.json({ token, username: user.username });
});
app.post('/api/logout', (req, res) => {
  const token = bearerToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const user = userForToken(bearerToken(req));
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  res.json({ username: user.username });
});
app.post('/api/change-password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(oldPassword || ''), user.password_hash)) {
    return res.status(400).json({ error: '旧密码错误' });
  }
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: '新密码至少 6 位' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(newPassword)), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  res.json({ ok: true, message: '密码已修改，请重新登录' });
});

// ===== 版本历史：保存时自动快照（每本书保留最近 30 个 auto 版本） =====
const MAX_AUTO_VERSIONS = 30;

function snapshotVersion(bookId, data, entryCount, kind, note) {
  const latest = db.prepare('SELECT data FROM book_versions WHERE book_id = ? ORDER BY id DESC LIMIT 1').get(bookId);
  const json = JSON.stringify(data);
  if (latest && latest.data === json) return false; // 内容没变不存
  db.prepare('INSERT INTO book_versions (book_id, data, entry_count, kind, note) VALUES (?, ?, ?, ?, ?)')
    .run(bookId, json, entryCount, kind || 'auto', note || '');
  // 清理：只清 auto，保留 manual
  const autos = db.prepare('SELECT id FROM book_versions WHERE book_id = ? AND kind = ? ORDER BY id DESC').all(bookId, 'auto');
  if (autos.length > MAX_AUTO_VERSIONS) {
    const keep = new Set(autos.slice(0, MAX_AUTO_VERSIONS).map(r => r.id));
    const del = autos.filter(r => !keep.has(r.id)).map(r => r.id);
    if (del.length) db.prepare('DELETE FROM book_versions WHERE id IN (' + del.join(',') + ')').run();
  }
  return true;
}

// ===== 版本 API =====
app.get('/api/books/:id/versions', authRequired, (req, res) => {
  const rows = db.prepare('SELECT id, entry_count, kind, note, data, created_at FROM book_versions WHERE book_id = ? ORDER BY id DESC LIMIT 50').all(req.params.id);
  const list = rows.map(r => {
    let titles = [];
    try {
      const data = JSON.parse(r.data);
      titles = Object.values(data.entries || {}).slice(0, 3).map(e => String(e.comment || '(无标题)'));
    } catch {}
    return { id: r.id, entry_count: r.entry_count, kind: r.kind, note: r.note, created_at: r.created_at, titles };
  });
  res.json(list);
});

app.get('/api/books/:id/versions/:vid', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM book_versions WHERE id = ? AND book_id = ?').get(req.params.vid, req.params.id);
  if (!row) return res.status(404).json({ error: '版本不存在' });
  res.json({ id: row.id, data: JSON.parse(row.data), entry_count: row.entry_count, kind: row.kind, note: row.note, created_at: row.created_at });
});

app.post('/api/books/:id/rollback', authRequired, (req, res) => {
  const bookId = req.params.id;
  const vid = Number((req.body || {}).vid);
  const note = String((req.body || {}).note || '').trim();
  const version = db.prepare('SELECT * FROM book_versions WHERE id = ? AND book_id = ?').get(vid, bookId);
  if (!version) return res.status(404).json({ error: '版本不存在' });
  const current = db.prepare('SELECT data FROM world_books WHERE id = ?').get(bookId);
  // 回滚前备份当前状态（防误回滚丢数据）
  if (current) {
    const cur = JSON.parse(current.data);
    snapshotVersion(bookId, cur, Object.keys(cur.entries || {}).length, 'auto', '回滚前快照');
  }
  const data = JSON.parse(version.data);
  const entryCount = Object.keys(data.entries || {}).length;
  db.prepare("UPDATE world_books SET data = ?, entry_count = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(data), entryCount, bookId);
  res.json({ ok: true, entry_count: entryCount, note: note || ('回滚到版本 #' + vid) });
});

// ===== 网络搜索代理：Bing 主源 + DuckDuckGo 备源（免费无 key） =====
const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function decodeBingUrl(href) {
  try {
    const u = String(href).match(/[?&]u=([^&]+)/);
    if (u) {
      const b64 = decodeURIComponent(u[1]).replace(/^a1/, '');
      const pad = b64 + '='.repeat((4 - b64.length % 4) % 4);
      const url = Buffer.from(pad, 'base64').toString('utf8');
      if (url.startsWith('http')) return url;
    }
  } catch {}
  return href;
}

async function searchBing(q) {
  const r = await fetch('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=zh-hans', {
    headers: { 'User-Agent': SEARCH_UA }
  });
  const html = await r.text();
  const results = [];
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/g;
  let m;
  while ((m = re.exec(html)) !== null && results.length < 8) {
    const title = String(m[2] || '').replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
    const snippet = String(m[3] || '').replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
    if (title) results.push({ title, url: decodeBingUrl(m[1]), snippet });
  }
  return { results, limited: r.status === 429 || results.length === 0 && html.length < 30000 };
}

function decodeDdgUrl(href) {
  try {
    const m = String(href).match(/uddg=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : href;
  } catch { return href; }
}

async function searchDdg(q) {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
    headers: { 'User-Agent': SEARCH_UA }
  });
  const html = await r.text();
  const limited = r.status >= 400 || html.includes('anomaly') || html.includes('unusual traffic');
  const results = [];
  if (!limited) {
    const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null && results.length < 8) {
      const title = String(m[2] || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
      if (title) results.push({ title, url: decodeDdgUrl(m[1]), snippet: '' });
    }
  }
  return { results, limited };
}

app.post('/api/proxy/search', authRequired, async (req, res) => {
  const q = String((req.body || {}).q || '').trim();
  if (!q || q.length > 200) return res.status(400).json({ error: '缺少搜索词' });
  try {
    const bing = await searchBing(q);
    if (bing.results.length) return res.json({ query: q, results: bing.results, source: 'bing' });
    const ddg = await searchDdg(q);
    if (ddg.results.length) return res.json({ query: q, results: ddg.results, source: 'duckduckgo' });
    if (bing.limited || ddg.limited) return res.status(503).json({ error: '搜索服务暂时被限流，请稍后再试' });
    res.json({ query: q, results: [], source: 'none' });
  } catch (e) {
    res.status(502).json({ error: '搜索失败: ' + e.message });
  }
});

// 数据 API 全部需要登录
app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);

// ===== AI 会话与记忆持久化（按世界书，替代 localStorage） =====
app.get('/api/ai-data/:bookId', (req, res) => {
  if (!/^\d+$/.test(req.params.bookId)) return res.json({ memory: null, sessions: null, activeSession: null });
  const row = db.prepare('SELECT memory, sessions, active_session FROM ai_data WHERE book_id = ?').get(Number(req.params.bookId));
  if (!row) return res.json({ memory: null, sessions: null, activeSession: null });
  const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  res.json({ memory: parse(row.memory), sessions: parse(row.sessions), activeSession: row.active_session || null });
});

app.put('/api/ai-data/:bookId', (req, res) => {
  if (!/^\d+$/.test(req.params.bookId)) return res.status(400).json({ error: 'invalid bookId' });
  const bookId = Number(req.params.bookId);
  const body = req.body || {};
  const kv = [];
  const vals = [];
  if (Object.prototype.hasOwnProperty.call(body, 'memory')) {
    kv.push('memory'); vals.push(body.memory == null ? null : JSON.stringify(body.memory));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sessions')) {
    kv.push('sessions'); vals.push(body.sessions == null ? null : JSON.stringify(body.sessions));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'activeSession')) {
    kv.push('active_session'); vals.push(body.activeSession == null ? null : String(body.activeSession));
  }
  if (!kv.length) return res.status(400).json({ error: 'no fields' });
  kv.push('updated_at');
  const ph = kv.map(k => k === 'updated_at' ? "datetime('now')" : '?');
  const upd = kv.map(k => k === 'updated_at' ? 'updated_at = excluded.updated_at' : k + ' = excluded.' + k).join(', ');
  db.prepare(`INSERT INTO ai_data (book_id, ${kv.join(', ')}) VALUES (?, ${ph.join(', ')}) ON CONFLICT(book_id) DO UPDATE SET ${upd}`).run(bookId, ...vals);
  res.json({ ok: true });
});

// ===== 外置存储同步（WebDAV / S3 兼容端点，数据级 JSON bundle） =====
// bundle 格式：{"format":"wbe-cloud-bundle","version":1,"exportedAt":ISO,"books":[...],"aiData":[...]}
// 只同步世界书与 AI 记忆/会话，不含用户账号；恢复前自动备份本地到 backups/cloud/

function getCloudConfig() {
  const row = db.prepare('SELECT * FROM cloud_config WHERE id = 1').get();
  return row || null;
}
function saveCloudConfig(cfg) {
  const cols = ['provider', 'webdav_url', 'webdav_user', 'webdav_pass', 's3_endpoint', 's3_region', 's3_bucket', 's3_access_key', 's3_secret_key', 'remote_path', 'updated_at'];
  const kv = cols.filter(c => c !== 'updated_at' && cfg[c] !== undefined).map(c => c);
  const ph = kv.map(() => '?');
  const upd = kv.map(c => c + ' = excluded.' + c);
  db.prepare(`INSERT INTO cloud_config (id, ${kv.join(', ')}, updated_at) VALUES (1, ${ph.join(', ')}, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET ${upd.join(', ')}, updated_at = excluded.updated_at`).run(...kv.map(c => cfg[c]));
}

function buildBundle() {
  const books = db.prepare('SELECT id, name, data, entry_count FROM world_books ORDER BY id').all();
  const ai = db.prepare('SELECT book_id, memory, sessions, active_session FROM ai_data ORDER BY book_id').all();
  return {
    format: 'wbe-cloud-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: books.map(b => ({ id: b.id, name: b.name, entry_count: b.entry_count, data: JSON.parse(b.data) })),
    aiData: ai.map(a => ({
      book_id: a.book_id,
      memory: a.memory == null ? null : JSON.parse(a.memory),
      sessions: a.sessions == null ? null : JSON.parse(a.sessions),
      active_session: a.active_session
    }))
  };
}

// 恢复前把当前库完整导出备份到 backups/cloud/
function backupPreRestore() {
  try {
    const dir = path.join(__dirname, 'backups', 'cloud');
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(dir, ts + '-pre-restore.json'), JSON.stringify(buildBundle()));
    // 保留最近 10 份恢复前备份
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    while (files.length > 10) fs.unlinkSync(path.join(dir, files.shift()));
  } catch (e) {
    console.error('[WBE] 恢复前备份失败:', e.message);
  }
}

function restoreBundle(bundle) {
  if (!bundle || bundle.format !== 'wbe-cloud-bundle' || !Array.isArray(bundle.books)) {
    throw new Error('不是有效的云端备份文件');
  }
  backupPreRestore();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM world_books').run();
    db.prepare('DELETE FROM ai_data').run();
    const insBook = db.prepare('INSERT INTO world_books (id, name, data, entry_count) VALUES (?, ?, ?, ?)');
    const insAi = db.prepare('INSERT INTO ai_data (book_id, memory, sessions, active_session) VALUES (?, ?, ?, ?)');
    for (const b of bundle.books) {
      const entryCount = Number.isInteger(b.entry_count) ? b.entry_count : Object.keys((b.data && b.data.entries) || {}).length;
      insBook.run(b.id, String(b.name || '未命名'), JSON.stringify(b.data || { entries: {} }), entryCount);
    }
    for (const a of bundle.aiData || []) {
      insAi.run(a.book_id, a.memory == null ? null : JSON.stringify(a.memory), a.sessions == null ? null : JSON.stringify(a.sessions), a.active_session || null);
    }
  });
  tx();
  return { books: bundle.books.length, ai: (bundle.aiData || []).length };
}

// ---- WebDAV（纯 HTTP PUT/GET + Basic Auth） ----
function webdavAuthHeader(cfg) {
  if (!cfg.webdav_user) return {};
  return { 'Authorization': 'Basic ' + Buffer.from(cfg.webdav_user + ':' + (cfg.webdav_pass || '')).toString('base64') };
}
function webdavTarget(cfg) {
  let base = String(cfg.webdav_url || '').trim().replace(/\/+$/, '');
  const p = String(cfg.remote_path || 'world-books-backup.json').replace(/^\/+/, '');
  return base + '/' + p;
}
async function webdavPut(cfg, path, body) {
  let base = String(cfg.webdav_url || '').trim().replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  const r = await fetch(base + '/' + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...webdavAuthHeader(cfg) },
    body
  });
  if (!r.ok && r.status !== 201 && r.status !== 204) throw new Error('WebDAV PUT ' + r.status);
  return r;
}
async function webdavGet(cfg, path) {
  let base = String(cfg.webdav_url || '').trim().replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  const r = await fetch(base + '/' + p, { headers: { ...webdavAuthHeader(cfg) } });
  if (!r.ok) throw new Error('WebDAV GET ' + r.status);
  return r.text();
}

// ---- S3 兼容端点（手写 SigV4，无 SDK 依赖；覆盖 AWS/OSS/COS/R2/MinIO） ----
function s3Sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function s3Hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}
function s3EncodePath(p) {
  return p.split('/').map(seg => encodeURIComponent(seg).replace(/%2F/gi, '/')).join('/');
}
// 生成 SigV4 请求头（PUT/GET 对象）
function s3Headers(cfg, method, objectPath, body, extraHeaders) {
  const endpoint = String(cfg.s3_endpoint || '').trim().replace(/\/+$/, '');
  const region = String(cfg.s3_region || 'us-east-1').trim();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = '/' + s3EncodePath(String(cfg.s3_bucket || '') + '/' + String(objectPath || '').replace(/^\/+/, ''));
  const payloadHash = body == null ? s3Sha256hex('') : s3Sha256hex(body);
  const host = new URL(endpoint).host;
  const headers = {
    'host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders
  };
  const canonicalHeaders = Object.keys(headers).sort().map(k => k + ':' + headers[k]).join('\n') + '\n';
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalRequest = [
    method, canonicalUri, '',
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');
  const scope = dateStamp + '/' + region + '/s3/aws4_request';
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope,
    s3Sha256hex(canonicalRequest)
  ].join('\n');
  const kDate = s3Hmac('AWS4' + cfg.s3_secret_key, dateStamp);
  const kRegion = s3Hmac(kDate, region);
  const kService = s3Hmac(kRegion, 's3');
  const kSigning = s3Hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    'Authorization': 'AWS4-HMAC-SHA256 Credential=' + cfg.s3_access_key + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
    'X-Amz-Date': amzDate,
    'x-amz-content-sha256': payloadHash
  };
}
function s3ObjectUrl(cfg, objectPath) {
  const endpoint = String(cfg.s3_endpoint || '').trim().replace(/\/+$/, '');
  return endpoint + '/' + s3EncodePath(String(cfg.s3_bucket || '') + '/' + String(objectPath || '').replace(/^\/+/, ''));
}
async function s3Put(cfg, objectPath, body) {
  const p = String(objectPath || '').replace(/^\/+/, '');
  const headers = s3Headers(cfg, 'PUT', p, body, { 'Content-Type': 'application/json' });
  const r = await fetch(s3ObjectUrl(cfg, p), { method: 'PUT', headers, body });
  if (!r.ok) throw new Error('S3 PUT ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r;
}
async function s3Get(cfg, objectPath) {
  const p = String(objectPath || '').replace(/^\/+/, '');
  const headers = s3Headers(cfg, 'GET', p, null);
  const r = await fetch(s3ObjectUrl(cfg, p), { headers });
  if (!r.ok) throw new Error('S3 GET ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.text();
}

// ---- 云端动作统一入口 ----
function cloudAction(cfg) {
  const mainPath = String(cfg.remote_path || 'world-books-backup.json').replace(/^\/+/, '');
  return {
    upload: (path, body) => cfg.provider === 's3' ? s3Put(cfg, path, body) : webdavPut(cfg, path, body),
    download: (path) => cfg.provider === 's3' ? s3Get(cfg, path || mainPath) : webdavGet(cfg, path || mainPath)
  };
}
// 版本文件路径：remote_path 的 stem 加时间戳后缀
function versionPathFor(cfg, ts) {
  const p = String(cfg.remote_path || 'world-books-backup.json').replace(/^\/+/, '');
  const dot = p.lastIndexOf('.');
  return (dot > 0 ? p.slice(0, dot) : p) + '-' + ts + (dot > 0 ? p.slice(dot) : '');
}
async function cloudTest(cfg) {
  if (cfg.provider === 's3') {
    if (!cfg.s3_endpoint || !cfg.s3_bucket || !cfg.s3_access_key || !cfg.s3_secret_key) return { ok: false, error: 'S3 配置不完整' };
    // ListObjectsV2（max-keys=1）验证凭据与网络
    const objectPath = String(cfg.remote_path || 'world-books-backup.json').replace(/^\/+/, '');
    const qs = '?list-type=2&max-keys=1&prefix=' + encodeURIComponent(objectPath);
    const endpoint = String(cfg.s3_endpoint || '').trim().replace(/\/+$/, '');
    const region = String(cfg.s3_region || 'us-east-1').trim();
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const canonicalUri = '/' + s3EncodePath(String(cfg.s3_bucket || ''));
    const payloadHash = s3Sha256hex('');
    const host = new URL(endpoint).host;
    const headers = { 'host': host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const canonicalHeaders = Object.keys(headers).sort().map(k => k + ':' + headers[k]).join('\n') + '\n';
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalRequest = ['GET', canonicalUri, qs.slice(1), canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = dateStamp + '/' + region + '/s3/aws4_request';
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, s3Sha256hex(canonicalRequest)].join('\n');
    const kDate = s3Hmac('AWS4' + cfg.s3_secret_key, dateStamp);
    const kRegion = s3Hmac(kDate, region);
    const kService = s3Hmac(kRegion, 's3');
    const kSigning = s3Hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const auth = 'AWS4-HMAC-SHA256 Credential=' + cfg.s3_access_key + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
    try {
      const r = await fetch(endpoint + canonicalUri + qs, { headers: { 'Authorization': auth, 'X-Amz-Date': amzDate, 'x-amz-content-sha256': payloadHash } });
      if (!r.ok) return { ok: false, error: 'S3 连接失败 ' + r.status + ': ' + (await r.text()).slice(0, 160) };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'S3 连接失败: ' + e.message };
    }
  }
  // WebDAV：GET 目标文件（404 表示可写不可读？不——用 PROPFIND 太重；GET 200/404 都算连通）
  if (!cfg.webdav_url) return { ok: false, error: 'WebDAV 配置不完整' };
  try {
    const r = await fetch(webdavTarget(cfg), { method: 'HEAD', headers: { ...webdavAuthHeader(cfg) } });
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'WebDAV 认证失败（' + r.status + '）' };
    if (r.ok || r.status === 404) return { ok: true };
    return { ok: false, error: 'WebDAV 连接异常 ' + r.status };
  } catch (e) {
    return { ok: false, error: 'WebDAV 连接失败: ' + e.message };
  }
}

// ===== API: 外置存储 =====
app.get('/api/cloud/config', (req, res) => {
  const cfg = getCloudConfig();
  res.json(cfg || { provider: 'webdav', remote_path: 'world-books-backup.json' });
});

app.put('/api/cloud/config', (req, res) => {
  const body = req.body || {};
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
  cfg.remote_path = String(body.remote_path || 'world-books-backup.json').trim().replace(/^\/+/, '') || 'world-books-backup.json';
  saveCloudConfig(cfg);
  res.json({ ok: true });
});

app.post('/api/cloud/test', (req, res) => {
  const cfg = getCloudConfig();
  if (!cfg) return res.status(400).json({ error: '尚未配置外置存储' });
  cloudTest(cfg).then(r => res.json(r));
});

app.post('/api/cloud/upload', async (req, res) => {
  const cfg = getCloudConfig();
  if (!cfg) return res.status(400).json({ error: '尚未配置外置存储' });
  try {
    const bundle = JSON.stringify(buildBundle());
    const ts = new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/g, '').slice(0, 15);
    const mainPath = String(cfg.remote_path || 'world-books-backup.json').replace(/^\/+/, '');
    // 主文件 + 时间戳版本文件；版本清单保留最近 5 条
    await cloudAction(cfg).upload(mainPath, bundle);
    const vpath = versionPathFor(cfg, ts);
    await cloudAction(cfg).upload(vpath, bundle);
    db.prepare('INSERT INTO cloud_versions (path) VALUES (?)').run(vpath);
    db.prepare('DELETE FROM cloud_versions WHERE id NOT IN (SELECT id FROM cloud_versions ORDER BY id DESC LIMIT 5)').run();
    saveCloudConfig({ ...cfg, updated_at: new Date().toISOString() });
    res.json({ ok: true, books: JSON.parse(bundle).books.length, exportedAt: JSON.parse(bundle).exportedAt, versionPath: vpath });
  } catch (e) {
    res.status(502).json({ error: '上传失败: ' + e.message });
  }
});

app.get('/api/cloud/versions', (req, res) => {
  const rows = db.prepare('SELECT path, uploaded_at FROM cloud_versions ORDER BY id DESC LIMIT 5').all();
  res.json({ versions: rows });
});

app.post('/api/cloud/download', async (req, res) => {
  const cfg = getCloudConfig();
  if (!cfg) return res.status(400).json({ error: '尚未配置外置存储' });
  try {
    const { versionPath } = req.body || {};
    const text = await cloudAction(cfg).download(versionPath);
    let bundle;
    try { bundle = JSON.parse(text); } catch (e) { throw new Error('云端文件不是有效 JSON'); }
    const stat = restoreBundle(bundle);
    res.json({ ok: true, ...stat, exportedAt: bundle.exportedAt || null });
  } catch (e) {
    res.status(502).json({ error: '拉取失败: ' + e.message });
  }
});

// ===== API: 列出所有世界书 =====
app.get('/api/books', (req, res) => {
  const rows = db.prepare('SELECT id, name, entry_count, created_at, updated_at FROM world_books ORDER BY updated_at DESC').all();
  res.json(rows);
});

// ===== API: 获取世界书 =====
app.get('/api/books/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM world_books WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ id: row.id, name: row.name, data: JSON.parse(row.data), entry_count: row.entry_count, updated_at: row.updated_at });
});

// ===== API: 创建世界书（导入） =====
app.post('/api/books', (req, res) => {
  const { name, data } = req.body;
  if (!data || !data.entries) return res.status(400).json({ error: 'invalid data' });
  const entryCount = Object.keys(data.entries).length;
  const result = db.prepare('INSERT INTO world_books (name, data, entry_count) VALUES (?, ?, ?)').run(name || 'untitled', JSON.stringify(data), entryCount);
  res.json({ id: result.lastInsertRowid, entry_count: entryCount });
});

// ===== API: 保存世界书（自动保存） =====
app.put('/api/books/:id', (req, res) => {
  const existing = db.prepare('SELECT id, updated_at FROM world_books WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { data, name, baseUpdatedAt, force } = req.body;
  if (!data || !data.entries) return res.status(400).json({ error: 'invalid data' });
  // 多端冲突检测：baseUpdatedAt 与库中 updated_at 不一致 = 数据已在别处被修改
  if (!force && baseUpdatedAt && existing.updated_at !== baseUpdatedAt) {
    return res.status(409).json({ error: 'conflict', message: '数据已在其他设备/标签页被修改', serverUpdatedAt: existing.updated_at });
  }
  const entryCount = Object.keys(data.entries).length;
  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  updates.push('data = ?', 'entry_count = ?', "updated_at = datetime('now')");
  params.push(JSON.stringify(data), entryCount, req.params.id);
  db.prepare(`UPDATE world_books SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  snapshotVersion(req.params.id, data, entryCount, 'auto', '');
  const row = db.prepare('SELECT updated_at FROM world_books WHERE id = ?').get(req.params.id);
  res.json({ ok: true, entry_count: entryCount, updated_at: row.updated_at });
});

// ===== API: 删除世界书（删除前自动备份到 backups/deleted/，防止误删） =====
app.delete('/api/books/:id', (req, res) => {
  const row = db.prepare('SELECT id, name, data FROM world_books WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  try {
    const dir = path.join(__dirname, 'backups', 'deleted');
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = String(row.name || 'book').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    fs.writeFileSync(path.join(dir, ts + '-' + row.id + '-' + safeName + '.json'), row.data);
    // 保留最近 20 份删除备份（文件名时间戳前缀，字典序即时间序）
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    while (files.length > 20) fs.unlinkSync(path.join(dir, files.shift()));
  } catch (e) {
    console.error('[WBE] 删除备份失败:', e.message);
  }
  db.prepare('DELETE FROM world_books WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== 首次启动：导入 sample.json =====
const count = db.prepare('SELECT COUNT(*) as c FROM world_books').get().c;
if (count === 0) {
  const samplePath = path.join(__dirname, 'sample.json');
  if (fs.existsSync(samplePath)) {
    const data = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    const entryCount = Object.keys(data.entries).length;
    db.prepare('INSERT INTO world_books (name, data, entry_count) VALUES (?, ?, ?)').run('sample.json', JSON.stringify(data), entryCount);
    console.log('[WBE] Imported sample.json (' + entryCount + ' entries)');
  }
}

// ===== AI 代理：解决第三方网关真实响应缺 CORS 头导致浏览器拦截的问题 =====
// 规整出 .../v1 基址
function normalizeBase(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/, '');
  u = u.replace(/\/models$/, '');
  if (!u.endsWith('/v1')) u = u.replace(/\/v1$/, '') + '/v1';
  return u;
}

// 拉取模型列表
app.post('/api/proxy/models', async (req, res) => {
  const { url, key } = req.body || {};
  if (!url || !key) return res.status(400).json({ error: '缺少 url 或 key' });
  try {
    const r = await fetch(normalizeBase(url) + '/models', {
      headers: { 'Authorization': 'Bearer ' + key }
    });
    const text = await r.text();
    res.status(r.status).type('application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: '代理请求失败: ' + e.message });
  }
});

// 流式聊天补全（把上游 SSE 原样透传回浏览器）
app.post('/api/proxy/chat', async (req, res) => {
  const { url, key, body } = req.body || {};
  if (!url || !key || !body) return res.status(400).json({ error: '缺少 url / key / body' });
  // 客户端断开（取消/超时/关页）时中止上游请求，避免资源泄漏
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  try {
    const r = await fetch(normalizeBase(url) + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body),
      signal: ac.signal
    });
    res.status(r.status);
    res.set('Content-Type', r.headers.get('content-type') || 'text/event-stream');
    res.set('Cache-Control', 'no-store');
    if (!r.body) { res.end(); return; }
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) {
    if (ac.signal.aborted) return; // 客户端已断开，无需响应
    res.status(502).json({ error: '代理请求失败: ' + e.message });
  }
});

// ===== API: 测试工具 =====
app.post('/api/test-tool', (req, res) => {
  const { tool, args } = req.body;
  const bookRow = db.prepare('SELECT data FROM world_books ORDER BY updated_at DESC LIMIT 1').get();
  if (!bookRow) return res.json({ error: 'no books' });
  const book = JSON.parse(bookRow.data);
  const entries = Object.values(book.entries);

  if (tool === 'search_entries') {
    const query = (args.query || '').toLowerCase();
    let list = entries;
    if (args.filter === 'constant') list = list.filter(e => e.constant && !e.disable);
    else if (args.filter === 'keyword') list = list.filter(e => !e.constant && !e.disable);
    if (query) {
      list = list.filter(e =>
        (e.comment||'').toLowerCase().includes(query) ||
        (e.key||[]).some(k => k.toLowerCase().includes(query)) ||
        (e.content||'').toLowerCase().includes(query)
      );
    }
    return res.json({ count: list.length, results: list.slice(0, 5).map(e => ({ uid: e.uid, comment: e.comment })) });
  }
  res.json({ error: 'unknown tool' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('[WBE] Server running on port ' + PORT);
});
