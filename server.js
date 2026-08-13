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
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  setHeaders: (res) => res.set('Cache-Control', 'no-store')
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

// 数据 API 全部需要登录
app.use(['/api/books', '/api/proxy', '/api/test-tool'], authRequired);

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
  const existing = db.prepare('SELECT id FROM world_books WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { data, name } = req.body;
  if (!data || !data.entries) return res.status(400).json({ error: 'invalid data' });
  const entryCount = Object.keys(data.entries).length;
  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  updates.push('data = ?', 'entry_count = ?', "updated_at = datetime('now')");
  params.push(JSON.stringify(data), entryCount, req.params.id);
  db.prepare(`UPDATE world_books SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true, entry_count: entryCount });
});

// ===== API: 删除世界书 =====
app.delete('/api/books/:id', (req, res) => {
  const result = db.prepare('DELETE FROM world_books WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
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
