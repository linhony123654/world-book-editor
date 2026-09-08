import fs from 'node:fs';

const serverPath = 'server.js';
const boundaryPath = 'tests/server-books-boundary.test.mjs';
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

replaceOnce(
  "const { createAuthService, createLoginRateLimiter, registerAuthRoutes } = require('./server/auth');\n",
  "const { createAuthService, createLoginRateLimiter, registerAuthRoutes } = require('./server/auth');\n" +
  "const { createBooksService } = require('./server/books-service');\n" +
  "const { registerBookRoutes, registerVersionRoutes } = require('./server/books-routes');\n",
  'books imports'
);

replaceSection(
  '// ===== 版本历史：保存时自动快照（每本书保留最近 30 个 auto 版本） =====\n',
  '// ===== 网络搜索代理：Bing 主源 + DuckDuckGo 备源（免费无 key） =====\n',
  `// ===== Books / Versions =====\nconst booksService = createBooksService({ db, rootDir: __dirname });\nregisterVersionRoutes(app, { authRequired, booksService });\n\n`,
  'version service and routes'
);

replaceSection(
  '// ===== API: 列出所有世界书 =====\n',
  '// ===== AI 代理：解决第三方网关真实响应缺 CORS 头导致浏览器拦截的问题 =====\n',
  `// ===== Books API =====\nregisterBookRoutes(app, { booksService });\nbooksService.seedSampleIfEmpty();\n\n`,
  'book routes and sample seed'
);

for (const forbidden of [
  'const MAX_AUTO_VERSIONS = 30',
  'function snapshotVersion(',
  "app.get('/api/books/:id/versions'",
  "app.get('/api/books/:id/versions/:vid'",
  "app.post('/api/books/:id/rollback'",
  "app.get('/api/books',",
  "app.get('/api/books/:id',",
  "app.post('/api/books',",
  "app.put('/api/books/:id',",
  "app.delete('/api/books/:id',",
  "SELECT COUNT(*) as c FROM world_books",
  "INSERT INTO world_books (name, data, entry_count) VALUES (?, ?, ?)"
]) {
  if (server.includes(forbidden)) throw new Error(`Legacy books implementation remains in server.js: ${forbidden}`);
}

for (const required of [
  "require('./server/books-service')",
  "require('./server/books-routes')",
  'const booksService = createBooksService({ db, rootDir: __dirname });',
  'registerVersionRoutes(app, { authRequired, booksService });',
  "app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);",
  'registerBookRoutes(app, { booksService });',
  'booksService.seedSampleIfEmpty();'
]) {
  if (!server.includes(required)) throw new Error(`Missing books delegation in server.js: ${required}`);
}

const versionIndex = server.indexOf('registerVersionRoutes(app, { authRequired, booksService });');
const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
const bookIndex = server.indexOf('registerBookRoutes(app, { booksService });');
if (!(versionIndex >= 0 && authIndex > versionIndex && bookIndex > authIndex)) {
  throw new Error('Books/version route registration order changed');
}

fs.writeFileSync(serverPath, server);
fs.writeFileSync(boundaryPath, `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');\nconst service = fs.readFileSync(new URL('../server/books-service.js', import.meta.url), 'utf8');\nconst routes = fs.readFileSync(new URL('../server/books-routes.js', import.meta.url), 'utf8');\n\ntest('server delegates books and versions while preserving auth registration order', () => {\n  assert.match(server, /createBooksService\\(\\{ db, rootDir: __dirname \\}\\)/);\n  assert.match(server, /registerVersionRoutes\\(app, \\{ authRequired, booksService \\}\\)/);\n  assert.match(server, /registerBookRoutes\\(app, \\{ booksService \\}\\)/);\n  assert.match(server, /booksService\\.seedSampleIfEmpty\\(\\)/);\n  const versionIndex = server.indexOf('registerVersionRoutes(app, { authRequired, booksService });');\n  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");\n  const bookIndex = server.indexOf('registerBookRoutes(app, { booksService });');\n  assert.ok(versionIndex >= 0 && authIndex > versionIndex && bookIndex > authIndex);\n  for (const legacy of ['function snapshotVersion(', "app.get('/api/books/:id/versions'", "app.post('/api/books/:id/rollback'", "app.get('/api/books',", "app.put('/api/books/:id',", "app.delete('/api/books/:id',"]) {\n    assert.equal(server.includes(legacy), false, legacy);\n  }\n});\n\ntest('books service owns persistence, version policy, delete backup and seed lifecycle', () => {\n  for (const marker of ['function snapshotVersion(', 'function rollbackVersion(', 'function updateBook(', 'function backupDeletedBook(', 'function seedSampleIfEmpty()']) {\n    assert.equal(service.includes(marker), true, marker);\n  }\n  assert.match(service, /DEFAULT_MAX_AUTO_VERSIONS = 30/);\n  assert.match(service, /DEFAULT_DELETED_BACKUP_LIMIT = 20/);\n  assert.match(service, /回滚前快照/);\n});\n\ntest('books routes own HTTP mappings and keep version routes explicitly authenticated', () => {\n  for (const endpoint of ['/api/books/:id/versions', '/api/books/:id/versions/:vid', '/api/books/:id/rollback', '/api/books', '/api/books/:id']) {\n    assert.equal(routes.includes(endpoint), true, endpoint);\n  }\n  assert.match(routes, /registerVersionRoutes\\(app, \\{ authRequired, booksService \\}/);\n  assert.equal(routes.includes("app.get('/api/books/:id/versions', authRequired"), true);\n  assert.match(routes, /status\\(409\\)/);\n  assert.match(routes, /数据已在其他设备\/标签页被修改/);\n});\n`);

console.log('Server books migration prepared.');
