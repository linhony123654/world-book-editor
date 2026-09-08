import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../server/ai-proxy-service.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../server/ai-proxy-routes.js', import.meta.url), 'utf8');

test('server delegates AI proxy after global auth and drops stream ownership', () => {
  for (const marker of [
    "require('./server/ai-proxy-service')",
    "require('./server/ai-proxy-routes')",
    'createAiProxyService()',
    'registerAiProxyRoutes(app, { aiProxyService })'
  ]) assert.equal(server.includes(marker), true, marker);
  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
  const proxyIndex = server.indexOf('registerAiProxyRoutes(app, { aiProxyService });');
  const testToolIndex = server.indexOf("app.post('/api/test-tool'");
  assert.ok(authIndex >= 0 && proxyIndex > authIndex && testToolIndex > proxyIndex);
  for (const legacy of [
    "require('stream')", 'function normalizeBase(',
    "app.post('/api/proxy/models'", "app.post('/api/proxy/chat'", 'Readable.fromWeb('
  ]) assert.equal(server.includes(legacy), false, legacy);
});

test('AI proxy service owns endpoint normalization and upstream request construction', () => {
  for (const marker of [
    'function normalizeBase(url)', 'async function fetchModels(url, key)',
    'async function fetchChat(url, key, body, signal)', "'/chat/completions'", "'/models'",
    "Authorization: 'Bearer ' + key", 'JSON.stringify(body)'
  ]) assert.equal(service.includes(marker), true, marker);
});

test('AI proxy routes own status passthrough, stream piping and abort lifecycle', () => {
  for (const marker of [
    "app.post('/api/proxy/models'", "app.post('/api/proxy/chat'",
    "res.on('close'", 'controller.abort()', 'controller.signal.aborted',
    "res.set('Cache-Control', 'no-store')", "'text/event-stream'", 'ReadableImpl.fromWeb(upstream.body).pipe(res)',
    "{ error: '代理请求失败: ' + error.message }"
  ]) assert.equal(routes.includes(marker), true, marker);
});
