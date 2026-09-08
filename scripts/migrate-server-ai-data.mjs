import fs from 'node:fs';

const serverPath = 'server.js';
const boundaryPath = 'tests/server-ai-data-boundary.test.mjs';
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
  "const { registerBookRoutes, registerVersionRoutes } = require('./server/books-routes');\n",
  "const { registerBookRoutes, registerVersionRoutes } = require('./server/books-routes');\n" +
  "const { createAiDataService } = require('./server/ai-data-service');\n" +
  "const { registerAiDataRoutes } = require('./server/ai-data-routes');\n",
  'AI data imports'
);

replaceSection(
  '// ===== AI 会话与记忆持久化（按世界书，替代 localStorage） =====\n',
  '// ===== 外置存储同步（WebDAV / S3 兼容端点，数据级 JSON bundle） =====\n',
  `// ===== AI Data =====\nconst aiDataService = createAiDataService({ db });\nregisterAiDataRoutes(app, { aiDataService });\n\n`,
  'AI data routes'
);

for (const forbidden of [
  "app.get('/api/ai-data/:bookId'",
  "app.put('/api/ai-data/:bookId'",
  'SELECT memory, sessions, active_session FROM ai_data WHERE book_id = ?',
  'ON CONFLICT(book_id) DO UPDATE SET ${upd}',
  'const parse = s =>'
]) {
  if (server.includes(forbidden)) throw new Error(`Legacy AI data implementation remains: ${forbidden}`);
}

for (const required of [
  "require('./server/ai-data-service')",
  "require('./server/ai-data-routes')",
  'const aiDataService = createAiDataService({ db });',
  'registerAiDataRoutes(app, { aiDataService });',
  "app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);"
]) {
  if (!server.includes(required)) throw new Error(`Missing AI data delegation: ${required}`);
}

const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
const aiDataIndex = server.indexOf('registerAiDataRoutes(app, { aiDataService });');
if (!(authIndex >= 0 && aiDataIndex > authIndex)) throw new Error('AI data routes moved before global auth middleware');

fs.writeFileSync(serverPath, server);
fs.writeFileSync(boundaryPath, `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');\nconst service = fs.readFileSync(new URL('../server/ai-data-service.js', import.meta.url), 'utf8');\nconst routes = fs.readFileSync(new URL('../server/ai-data-routes.js', import.meta.url), 'utf8');\n\ntest('server delegates AI data persistence after global auth middleware', () => {\n  for (const marker of [\n    "require('./server/ai-data-service')",\n    "require('./server/ai-data-routes')",\n    'createAiDataService({ db })',\n    'registerAiDataRoutes(app, { aiDataService })'\n  ]) assert.equal(server.includes(marker), true, marker);\n  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");\n  const aiDataIndex = server.indexOf('registerAiDataRoutes(app, { aiDataService });');\n  assert.ok(authIndex >= 0 && aiDataIndex > authIndex);\n  for (const legacy of [\n    "app.get('/api/ai-data/:bookId'",\n    "app.put('/api/ai-data/:bookId'",\n    'SELECT memory, sessions, active_session FROM ai_data WHERE book_id = ?'\n  ]) assert.equal(server.includes(legacy), false, legacy);\n});\n\ntest('AI data service owns JSON tolerance and partial UPSERT semantics', () => {\n  for (const marker of [\n    'function parseJsonOrNull(',\n    'function isValidBookId(',\n    'function get(bookId)',\n    'function update(bookId, body = {})',\n    "Object.prototype.hasOwnProperty.call(body, 'memory')",\n    "Object.prototype.hasOwnProperty.call(body, 'sessions')",\n    "Object.prototype.hasOwnProperty.call(body, 'activeSession')",\n    'ON CONFLICT(book_id) DO UPDATE SET'\n  ]) assert.equal(service.includes(marker), true, marker);\n});\n\ntest('AI data routes own current HTTP mappings without per-route auth', () => {\n  for (const marker of [\n    "app.get('/api/ai-data/:bookId'",\n    "app.put('/api/ai-data/:bookId'",\n    "{ error: 'invalid bookId' }",\n    "{ error: 'no fields' }"\n  ]) assert.equal(routes.includes(marker), true, marker);\n});\n`);

console.log('Server AI data migration prepared.');
