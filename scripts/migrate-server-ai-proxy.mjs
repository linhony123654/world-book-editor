import fs from 'node:fs';

const serverPath = 'server.js';
const boundaryPath = 'tests/server-ai-proxy-boundary.test.mjs';
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

replaceOnce("const { Readable } = require('stream');\n", '', 'inline stream dependency');
replaceOnce(
  "const { registerSearchRoutes } = require('./server/search-routes');\n",
  "const { registerSearchRoutes } = require('./server/search-routes');\n" +
  "const { createAiProxyService } = require('./server/ai-proxy-service');\n" +
  "const { registerAiProxyRoutes } = require('./server/ai-proxy-routes');\n",
  'AI proxy imports'
);

replaceSection(
  '// ===== AI 代理：解决第三方网关真实响应缺 CORS 头导致浏览器拦截的问题 =====\n',
  '// ===== API: 测试工具 =====\n',
  `// ===== AI Proxy =====\nconst aiProxyService = createAiProxyService();\nregisterAiProxyRoutes(app, { aiProxyService });\n\n`,
  'AI proxy implementation and routes'
);

for (const forbidden of [
  "const { Readable } = require('stream')",
  'function normalizeBase(',
  "app.post('/api/proxy/models'",
  "app.post('/api/proxy/chat'",
  'new AbortController()',
  'Readable.fromWeb(',
  "'/chat/completions'",
  "'/models'"
]) {
  if (server.includes(forbidden)) throw new Error(`Legacy AI proxy implementation remains: ${forbidden}`);
}

for (const required of [
  "require('./server/ai-proxy-service')",
  "require('./server/ai-proxy-routes')",
  'const aiProxyService = createAiProxyService();',
  'registerAiProxyRoutes(app, { aiProxyService });'
]) {
  if (!server.includes(required)) throw new Error(`Missing AI proxy delegation: ${required}`);
}

const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
const proxyIndex = server.indexOf('registerAiProxyRoutes(app, { aiProxyService });');
const testToolIndex = server.indexOf("app.post('/api/test-tool'");
if (!(authIndex >= 0 && proxyIndex > authIndex && testToolIndex > proxyIndex)) {
  throw new Error('AI proxy route registration order changed');
}

fs.writeFileSync(serverPath, server);
fs.writeFileSync(boundaryPath, `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');\nconst service = fs.readFileSync(new URL('../server/ai-proxy-service.js', import.meta.url), 'utf8');\nconst routes = fs.readFileSync(new URL('../server/ai-proxy-routes.js', import.meta.url), 'utf8');\n\ntest('server delegates AI proxy after global auth and drops stream ownership', () => {\n  for (const marker of [\n    "require('./server/ai-proxy-service')",\n    "require('./server/ai-proxy-routes')",\n    'createAiProxyService()',\n    'registerAiProxyRoutes(app, { aiProxyService })'\n  ]) assert.equal(server.includes(marker), true, marker);\n  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");\n  const proxyIndex = server.indexOf('registerAiProxyRoutes(app, { aiProxyService });');\n  const testToolIndex = server.indexOf("app.post('/api/test-tool'");\n  assert.ok(authIndex >= 0 && proxyIndex > authIndex && testToolIndex > proxyIndex);\n  for (const legacy of [\n    "require('stream')", 'function normalizeBase(',\n    "app.post('/api/proxy/models'", "app.post('/api/proxy/chat'", 'Readable.fromWeb('\n  ]) assert.equal(server.includes(legacy), false, legacy);\n});\n\ntest('AI proxy service owns endpoint normalization and upstream request construction', () => {\n  for (const marker of [\n    'function normalizeBase(url)', 'async function fetchModels(url, key)',\n    'async function fetchChat(url, key, body, signal)', "'/chat/completions'", "'/models'",\n    "Authorization: 'Bearer ' + key", 'JSON.stringify(body)'\n  ]) assert.equal(service.includes(marker), true, marker);\n});\n\ntest('AI proxy routes own status passthrough, stream piping and abort lifecycle', () => {\n  for (const marker of [\n    "app.post('/api/proxy/models'", "app.post('/api/proxy/chat'",\n    "res.on('close'", 'controller.abort()', 'controller.signal.aborted',\n    "res.set('Cache-Control', 'no-store')", "'text/event-stream'", 'ReadableImpl.fromWeb(upstream.body).pipe(res)',\n    "{ error: '代理请求失败: ' + error.message }"\n  ]) assert.equal(routes.includes(marker), true, marker);\n});\n`);

console.log('Server AI proxy migration prepared.');
