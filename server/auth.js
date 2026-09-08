const crypto = require('crypto');

function createAuthService({ db, cryptoImpl = crypto } = {}) {
  if (!db) throw new TypeError('Auth service requires db');

  function hashPassword(pw) {
    const salt = cryptoImpl.randomBytes(16).toString('hex');
    const hash = cryptoImpl.scryptSync(String(pw), salt, 64).toString('hex');
    return 'scrypt:' + salt + ':' + hash;
  }

  function verifyPassword(pw, stored) {
    const [alg, salt, hash] = String(stored || '').split(':');
    if (alg !== 'scrypt' || !salt || !hash) return false;
    const test = cryptoImpl.scryptSync(String(pw), salt, 64).toString('hex');
    return cryptoImpl.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(hash, 'hex'));
  }

  function hasUsers() {
    return db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
  }

  function bearerToken(req) {
    return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  }

  function userForToken(token) {
    if (!token) return null;
    return db.prepare(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token) || null;
  }

  function createSession(userId) {
    db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
    const token = cryptoImpl.randomBytes(32).toString('hex');
    db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`).run(token, userId);
    return token;
  }

  function authRequired(req, res, next) {
    const user = userForToken(bearerToken(req));
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  }

  return {
    authRequired,
    bearerToken,
    createSession,
    hashPassword,
    hasUsers,
    userForToken,
    verifyPassword
  };
}

function createLoginRateLimiter({
  maxAttempts = 20,
  windowMs = 15 * 60 * 1000,
  cleanupIntervalMs = 5 * 60 * 1000,
  now = () => Date.now(),
  setIntervalImpl = setInterval
} = {}) {
  const attempts = new Map();

  function middleware(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const current = now();
    const rec = attempts.get(ip) || { count: 0, firstAt: current };
    if (current - rec.firstAt > windowMs) {
      rec.count = 0;
      rec.firstAt = current;
    }
    rec.count++;
    attempts.set(ip, rec);
    if (rec.count > maxAttempts) {
      return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试' });
    }
    next();
  }

  function cleanup() {
    const cutoff = now() - windowMs;
    for (const [ip, rec] of attempts) {
      if (rec.firstAt < cutoff) attempts.delete(ip);
    }
  }

  function startCleanup() {
    const timer = setIntervalImpl(cleanup, cleanupIntervalMs);
    timer?.unref?.();
    return timer;
  }

  return { attempts, cleanup, middleware, startCleanup };
}

function registerAuthRoutes(app, { db, authService, loginRateLimit } = {}) {
  if (!app) throw new TypeError('Auth routes require app');
  if (!db) throw new TypeError('Auth routes require db');
  if (!authService) throw new TypeError('Auth routes require authService');
  if (typeof loginRateLimit !== 'function') throw new TypeError('Auth routes require loginRateLimit');

  const {
    authRequired,
    bearerToken,
    createSession,
    hashPassword,
    hasUsers,
    userForToken,
    verifyPassword
  } = authService;

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
}

module.exports = {
  createAuthService,
  createLoginRateLimiter,
  registerAuthRoutes
};
