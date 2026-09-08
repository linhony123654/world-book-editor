import fs from 'node:fs';

const serverPath = 'server.js';
const boundaryPath = 'tests/server-foundation-boundary.test.mjs';
let server = fs.readFileSync(serverPath, 'utf8');

function replaceOnce(search, replacement, label) {
  const first = server.indexOf(search);
  if (first < 0) throw new Error(`Missing migration anchor: ${label}`);
  if (server.indexOf(search, first + search.length) >= 0) throw new Error(`Ambiguous migration anchor: ${label}`);
  server = server.replace(search, replacement);
}

function replaceSection(startMarker, endMarker, replacement, label) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Missing migration section: ${label}`);
  if (server.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error(`Ambiguous migration section start: ${label}`);
  server = server.slice(0, start) + replacement + server.slice(end);
}

replaceOnce("const Database = require('better-sqlite3');\n", '', 'inline database dependency');
replaceOnce(
  "const { Readable } = require('stream');\n",
  "const { Readable } = require('stream');\n" +
  "const { createDatabase } = require('./server/database');\n" +
  "const { createAuthService, createLoginRateLimiter, registerAuthRoutes } = require('./server/auth');\n",
  'server foundation imports'
);

replaceSection(
  '// ===== SQLite =====\n',
  '// ===== 版本历史：保存时自动快照（每本书保留最近 30 个 auto 版本） =====\n',
  `// ===== SQLite =====\nconst db = createDatabase();\n\n// ===== 认证 =====\nconst authService = createAuthService({ db });\nconst authRequired = authService.authRequired;\nconst loginLimiter = createLoginRateLimiter();\nconst loginRateLimit = loginLimiter.middleware;\nloginLimiter.startCleanup();\nregisterAuthRoutes(app, { db, authService, loginRateLimit });\n\n`,
  'database and auth foundation'
);

for (const forbidden of [
  "new Database(",
  'CREATE TABLE IF NOT EXISTS world_books',
  'function hashPassword(',
  'function verifyPassword(',
  'function hasUsers(',
  'function bearerToken(',
  'function userForToken(',
  'function createSession(',
  'function loginRateLimit(',
  "app.get('/api/auth-state'",
  "app.post('/api/setup'",
  "app.post('/api/login'",
  "app.post('/api/logout'",
  "app.get('/api/me'",
  "app.post('/api/change-password'"
]) {
  if (server.includes(forbidden)) throw new Error(`Legacy server foundation remains: ${forbidden}`);
}
for (const required of [
  "require('./server/database')",
  "require('./server/auth')",
  'const db = createDatabase();',
  'const authService = createAuthService({ db });',
  'const authRequired = authService.authRequired;',
  'const loginLimiter = createLoginRateLimiter();',
  'loginLimiter.startCleanup();',
  'registerAuthRoutes(app, { db, authService, loginRateLimit });'
]) {
  if (!server.includes(required)) throw new Error(`Missing server foundation delegation: ${required}`);
}

fs.writeFileSync(serverPath, server);
fs.writeFileSync(boundaryPath, `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');\nconst database = fs.readFileSync(new URL('../server/database.js', import.meta.url), 'utf8');\nconst auth = fs.readFileSync(new URL('../server/auth.js', import.meta.url), 'utf8');\n\ntest('server composes database and auth modules instead of owning their implementation', () => {\n  assert.match(server, /createDatabase\\(\\)/);\n  assert.match(server, /createAuthService\\(\\{ db \\}\\)/);\n  assert.match(server, /registerAuthRoutes\\(app, \\{ db, authService, loginRateLimit \\}\\)/);\n  assert.match(server, /loginLimiter\\.startCleanup\\(\\)/);\n  assert.doesNotMatch(server, /new Database\\(/);\n  assert.doesNotMatch(server, /CREATE TABLE IF NOT EXISTS world_books/);\n  assert.doesNotMatch(server, /function hashPassword\\(/);\n  assert.doesNotMatch(server, /function loginRateLimit\\(/);\n  assert.equal(server.includes("app.post('/api/login'"), false);\n});\n\ntest('database module owns current schema and WBE_DB resolution', () => {\n  assert.match(database, /process\\.env/);\n  assert.match(database, /world-books\\.db/);\n  for (const table of ['world_books', 'users', 'sessions', 'ai_data', 'cloud_config', 'cloud_versions', 'book_versions']) {\n    assert.equal(database.includes('CREATE TABLE IF NOT EXISTS ' + table), true);\n  }\n});\n\ntest('auth module owns password, session, limiter, middleware and auth endpoints', () => {\n  assert.match(auth, /cryptoImpl\\.scryptSync/);\n  assert.match(auth, /timingSafeEqual/);\n  assert.match(auth, /datetime\\('now', '\\+30 days'\\)/);\n  assert.match(auth, /res\\.status\\(401\\)\\.json\\(\\{ error: 'unauthorized' \\}\\)/);\n  assert.match(auth, /rec\\.count > maxAttempts/);\n  for (const path of ['/api/auth-state', '/api/setup', '/api/login', '/api/logout', '/api/me', '/api/change-password']) {\n    assert.equal(auth.includes(path), true);\n  }\n});\n`);

console.log('Server foundation migration prepared.');
