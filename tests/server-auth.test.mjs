import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDatabase } = require('../server/database.js');
const { createAuthService, createLoginRateLimiter, registerAuthRoutes } = require('../server/auth.js');

function makeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function makeApp() {
  const routes = [];
  return {
    routes,
    get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
    post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); }
  };
}

test('auth service preserves scrypt password format and verification semantics', () => {
  const db = createDatabase({ dbPath: ':memory:' });
  try {
    const auth = createAuthService({ db });
    const stored = auth.hashPassword('secret123');
    assert.match(stored, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.equal(auth.verifyPassword('secret123', stored), true);
    assert.equal(auth.verifyPassword('wrong', stored), false);
    assert.equal(auth.verifyPassword('secret123', 'broken'), false);
  } finally {
    db.close();
  }
});

test('session helpers preserve bearer parsing, 30-day token persistence and auth middleware', () => {
  const db = createDatabase({ dbPath: ':memory:' });
  try {
    const auth = createAuthService({ db });
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('alice', auth.hashPassword('password'));
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get('alice');
    const token = auth.createSession(user.id);

    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(auth.bearerToken({ headers: { authorization: 'Bearer ' + token } }), token);
    assert.deepEqual(auth.userForToken(token), { id: user.id, username: 'alice' });

    const okReq = { headers: { authorization: 'Bearer ' + token } };
    const okRes = makeResponse();
    let nextCalls = 0;
    auth.authRequired(okReq, okRes, () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(okReq.user.username, 'alice');

    const badRes = makeResponse();
    auth.authRequired({ headers: {} }, badRes, () => { throw new Error('must not continue'); });
    assert.equal(badRes.statusCode, 401);
    assert.deepEqual(badRes.body, { error: 'unauthorized' });
  } finally {
    db.close();
  }
});

test('login limiter allows 20 attempts, rejects the 21st and resets after 15 minutes', () => {
  let now = 1000;
  const limiter = createLoginRateLimiter({ now: () => now });
  const req = { ip: '127.0.0.1', socket: {} };
  let nextCalls = 0;

  for (let i = 0; i < 20; i++) {
    const res = makeResponse();
    limiter.middleware(req, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 200);
  }
  assert.equal(nextCalls, 20);

  const blocked = makeResponse();
  limiter.middleware(req, blocked, () => { nextCalls += 1; });
  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.body, { error: '尝试次数过多，请 15 分钟后再试' });

  now += 15 * 60 * 1000 + 1;
  const reset = makeResponse();
  limiter.middleware(req, reset, () => { nextCalls += 1; });
  assert.equal(reset.statusCode, 200);
  assert.equal(nextCalls, 21);
});

test('login limiter cleanup and timer keep stale-record/unref behavior', () => {
  let now = 0;
  let scheduled = null;
  let unrefCalls = 0;
  const limiter = createLoginRateLimiter({
    now: () => now,
    setIntervalImpl(fn, ms) {
      scheduled = { fn, ms };
      return { unref() { unrefCalls += 1; } };
    }
  });
  limiter.middleware({ ip: 'old', socket: {} }, makeResponse(), () => {});
  now = 15 * 60 * 1000 + 1;
  limiter.cleanup();
  assert.equal(limiter.attempts.has('old'), false);

  limiter.startCleanup();
  assert.equal(scheduled.ms, 5 * 60 * 1000);
  assert.equal(unrefCalls, 1);
});

test('auth routes preserve current endpoint and middleware registration', () => {
  const db = createDatabase({ dbPath: ':memory:' });
  try {
    const auth = createAuthService({ db });
    const app = makeApp();
    const limiter = () => {};
    registerAuthRoutes(app, { db, authService: auth, loginRateLimit: limiter });

    assert.deepEqual(app.routes.map(route => [route.method, route.path, route.handlers.length]), [
      ['GET', '/api/auth-state', 1],
      ['POST', '/api/setup', 2],
      ['POST', '/api/login', 2],
      ['POST', '/api/logout', 1],
      ['GET', '/api/me', 1],
      ['POST', '/api/change-password', 2]
    ]);
    assert.equal(app.routes.find(route => route.path === '/api/setup').handlers[0], limiter);
    assert.equal(app.routes.find(route => route.path === '/api/login').handlers[0], limiter);
    assert.equal(app.routes.find(route => route.path === '/api/change-password').handlers[0], auth.authRequired);
  } finally {
    db.close();
  }
});

test('setup/login/me/logout routes preserve validation and token lifecycle', () => {
  const db = createDatabase({ dbPath: ':memory:' });
  try {
    const auth = createAuthService({ db });
    const app = makeApp();
    registerAuthRoutes(app, { db, authService: auth, loginRateLimit: (req, res, next) => next() });
    const route = (method, path) => app.routes.find(item => item.method === method && item.path === path).handlers.at(-1);

    const invalid = makeResponse();
    route('POST', '/api/setup')({ body: { username: 'a', password: '123' } }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(invalid.body, { error: '用户名至少 2 位，密码至少 6 位' });

    const setup = makeResponse();
    route('POST', '/api/setup')({ body: { username: ' alice ', password: 'secret1' } }, setup);
    assert.equal(setup.statusCode, 200);
    assert.equal(setup.body.username, 'alice');
    assert.match(setup.body.token, /^[0-9a-f]{64}$/);

    const duplicate = makeResponse();
    route('POST', '/api/setup')({ body: { username: 'other', password: 'secret1' } }, duplicate);
    assert.equal(duplicate.statusCode, 403);
    assert.deepEqual(duplicate.body, { error: 'already initialized' });

    const badLogin = makeResponse();
    route('POST', '/api/login')({ body: { username: 'alice', password: 'wrong' } }, badLogin);
    assert.equal(badLogin.statusCode, 401);
    assert.deepEqual(badLogin.body, { error: '用户名或密码错误' });

    const login = makeResponse();
    route('POST', '/api/login')({ body: { username: 'alice', password: 'secret1' } }, login);
    assert.equal(login.statusCode, 200);

    const me = makeResponse();
    route('GET', '/api/me')({ headers: { authorization: 'Bearer ' + login.body.token } }, me);
    assert.deepEqual(me.body, { username: 'alice' });

    const logout = makeResponse();
    route('POST', '/api/logout')({ headers: { authorization: 'Bearer ' + login.body.token } }, logout);
    assert.deepEqual(logout.body, { ok: true });
    assert.equal(auth.userForToken(login.body.token), null);
  } finally {
    db.close();
  }
});
