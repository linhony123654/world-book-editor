import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../server/search-service.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../server/search-routes.js', import.meta.url), 'utf8');

test('server delegates search before global proxy auth middleware', () => {
  for (const marker of [
    "require('./server/search-service')",
    "require('./server/search-routes')",
    'createSearchService()',
    'registerSearchRoutes(app, { authRequired, searchService })'
  ]) assert.equal(server.includes(marker), true, marker);
  const versionIndex = server.indexOf('registerVersionRoutes(app, { authRequired, booksService });');
  const searchIndex = server.indexOf('registerSearchRoutes(app, { authRequired, searchService });');
  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
  assert.ok(versionIndex >= 0 && searchIndex > versionIndex && authIndex > searchIndex);
  for (const legacy of [
    'function decodeBingUrl(', 'async function searchBing(', 'function decodeDdgUrl(',
    'async function searchDdg(', "app.post('/api/proxy/search'"
  ]) assert.equal(server.includes(legacy), false, legacy);
});

test('search service owns source parsing, fallback and limited-state semantics', () => {
  for (const marker of [
    'const SEARCH_UA =', 'function decodeBingUrl(', 'function decodeDdgUrl(',
    'async function searchBing(query)', 'async function searchDdg(query)', 'async function search(query)',
    "source: 'bing'", "source: 'duckduckgo'", 'bing.limited || ddg.limited'
  ]) assert.equal(service.includes(marker), true, marker);
});

test('search route owns validation/status mapping and explicit auth registration', () => {
  for (const marker of [
    "app.post('/api/proxy/search', authRequired",
    'query.length > 200', "{ error: '缺少搜索词' }",
    "status(503).json({ error: '搜索服务暂时被限流，请稍后再试' })",
    "status(502).json({ error: '搜索失败: ' + error.message })"
  ]) assert.equal(routes.includes(marker), true, marker);
});
