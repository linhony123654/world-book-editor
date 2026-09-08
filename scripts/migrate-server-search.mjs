import fs from 'node:fs';

const serverPath = 'server.js';
const boundaryPath = 'tests/server-search-boundary.test.mjs';
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
  "const { registerCloudRoutes } = require('./server/cloud-routes');\n",
  "const { registerCloudRoutes } = require('./server/cloud-routes');\n" +
  "const { createSearchService } = require('./server/search-service');\n" +
  "const { registerSearchRoutes } = require('./server/search-routes');\n",
  'search imports'
);

replaceSection(
  '// ===== 网络搜索代理：Bing 主源 + DuckDuckGo 备源（免费无 key） =====\n',
  '// 数据 API 全部需要登录\n',
  `// ===== Search Proxy =====\nconst searchService = createSearchService();\nregisterSearchRoutes(app, { authRequired, searchService });\n\n`,
  'search implementation and route'
);

for (const forbidden of [
  'const SEARCH_UA =',
  'function decodeBingUrl(',
  'async function searchBing(',
  'function decodeDdgUrl(',
  'async function searchDdg(',
  "app.post('/api/proxy/search'",
  'https://www.bing.com/search?q=',
  'https://html.duckduckgo.com/html/?q='
]) {
  if (server.includes(forbidden)) throw new Error(`Legacy search implementation remains: ${forbidden}`);
}

for (const required of [
  "require('./server/search-service')",
  "require('./server/search-routes')",
  'const searchService = createSearchService();',
  'registerSearchRoutes(app, { authRequired, searchService });',
  "app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);"
]) {
  if (!server.includes(required)) throw new Error(`Missing search delegation: ${required}`);
}

const versionIndex = server.indexOf('registerVersionRoutes(app, { authRequired, booksService });');
const searchIndex = server.indexOf('registerSearchRoutes(app, { authRequired, searchService });');
const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
if (!(versionIndex >= 0 && searchIndex > versionIndex && authIndex > searchIndex)) {
  throw new Error('Search route registration order changed');
}

fs.writeFileSync(serverPath, server);
fs.writeFileSync(boundaryPath, `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');\nconst service = fs.readFileSync(new URL('../server/search-service.js', import.meta.url), 'utf8');\nconst routes = fs.readFileSync(new URL('../server/search-routes.js', import.meta.url), 'utf8');\n\ntest('server delegates search before global proxy auth middleware', () => {\n  for (const marker of [\n    "require('./server/search-service')",\n    "require('./server/search-routes')",\n    'createSearchService()',\n    'registerSearchRoutes(app, { authRequired, searchService })'\n  ]) assert.equal(server.includes(marker), true, marker);\n  const versionIndex = server.indexOf('registerVersionRoutes(app, { authRequired, booksService });');\n  const searchIndex = server.indexOf('registerSearchRoutes(app, { authRequired, searchService });');\n  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");\n  assert.ok(versionIndex >= 0 && searchIndex > versionIndex && authIndex > searchIndex);\n  for (const legacy of [\n    'function decodeBingUrl(', 'async function searchBing(', 'function decodeDdgUrl(',\n    'async function searchDdg(', "app.post('/api/proxy/search'"\n  ]) assert.equal(server.includes(legacy), false, legacy);\n});\n\ntest('search service owns source parsing, fallback and limited-state semantics', () => {\n  for (const marker of [\n    'const SEARCH_UA =', 'function decodeBingUrl(', 'function decodeDdgUrl(',\n    'async function searchBing(query)', 'async function searchDdg(query)', 'async function search(query)',\n    "source: 'bing'", "source: 'duckduckgo'", 'bing.limited || ddg.limited'\n  ]) assert.equal(service.includes(marker), true, marker);\n});\n\ntest('search route owns validation/status mapping and explicit auth registration', () => {\n  for (const marker of [\n    "app.post('/api/proxy/search', authRequired",\n    'query.length > 200', "{ error: '缺少搜索词' }",\n    "status(503).json({ error: '搜索服务暂时被限流，请稍后再试' })",\n    "status(502).json({ error: '搜索失败: ' + error.message })"\n  ]) assert.equal(routes.includes(marker), true, marker);\n});\n`);

console.log('Server search migration prepared.');
