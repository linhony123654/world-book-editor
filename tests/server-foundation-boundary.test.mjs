import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const database = fs.readFileSync(new URL('../server/database.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../server/auth.js', import.meta.url), 'utf8');

test('server composes database and auth modules instead of owning their implementation', () => {
  assert.match(server, /createDatabase\(\)/);
  assert.match(server, /createAuthService\(\{ db \}\)/);
  assert.match(server, /registerAuthRoutes\(app, \{ db, authService, loginRateLimit \}\)/);
  assert.match(server, /loginLimiter\.startCleanup\(\)/);
  assert.doesNotMatch(server, /new Database\(/);
  assert.doesNotMatch(server, /CREATE TABLE IF NOT EXISTS world_books/);
  assert.doesNotMatch(server, /function hashPassword\(/);
  assert.doesNotMatch(server, /function loginRateLimit\(/);
  assert.equal(server.includes("app.post('/api/login'"), false);
});

test('database module owns current schema and WBE_DB resolution', () => {
  assert.match(database, /process\.env/);
  assert.match(database, /world-books\.db/);
  for (const table of ['world_books', 'users', 'sessions', 'ai_data', 'cloud_config', 'cloud_versions', 'book_versions']) {
    assert.equal(database.includes('CREATE TABLE IF NOT EXISTS ' + table), true);
  }
});

test('auth module owns password, session, limiter, middleware and auth endpoints', () => {
  assert.match(auth, /cryptoImpl\.scryptSync/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(auth, /datetime\('now', '\+30 days'\)/);
  assert.match(auth, /res\.status\(401\)\.json\(\{ error: 'unauthorized' \}\)/);
  assert.match(auth, /rec\.count > maxAttempts/);
  for (const path of ['/api/auth-state', '/api/setup', '/api/login', '/api/logout', '/api/me', '/api/change-password']) {
    assert.equal(auth.includes(path), true);
  }
});
