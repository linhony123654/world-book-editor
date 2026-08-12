const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 8084;

app.use(express.json({ limit: '50mb' }));

// 静态文件白名单：只暴露前端文件，数据库/源码/依赖目录一律 404
const DENY_STATIC = /\.(db|db-wal|db-shm|sqlite|sqlite3)$|^\/node_modules\/|^\.(git|env|npmrc)/;
app.use((req, res, next) => {
  if (DENY_STATIC.test(req.path)) return res.status(404).end();
  next();
});
app.use(express.static(path.join(__dirname), {
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

// ===== 认证 API =====
app.get('/api/auth-state', (req, res) => {
  res.json({ initialized: hasUsers() });
});
app.post('/api/setup', (req, res) => {
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
app.post('/api/login', (req, res) => {
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
  try {
    const r = await fetch(normalizeBase(url) + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body)
    });
    res.status(r.status);
    res.set('Content-Type', r.headers.get('content-type') || 'text/event-stream');
    res.set('Cache-Control', 'no-store');
    if (!r.body) { res.end(); return; }
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) {
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
