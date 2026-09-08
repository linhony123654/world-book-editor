import fs from 'node:fs';

const serverPath = 'server.js';
const boundaryPath = 'tests/server-cloud-boundary.test.mjs';
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

replaceOnce("const fs = require('fs');\n", '', 'inline cloud fs dependency');
replaceOnce("const crypto = require('crypto');\n", '', 'inline cloud crypto dependency');
replaceOnce(
  "const { registerAiDataRoutes } = require('./server/ai-data-routes');\n",
  "const { registerAiDataRoutes } = require('./server/ai-data-routes');\n" +
  "const { createCloudTransports } = require('./server/cloud-transports');\n" +
  "const { createCloudService } = require('./server/cloud-service');\n" +
  "const { registerCloudRoutes } = require('./server/cloud-routes');\n",
  'cloud imports'
);

replaceSection(
  '// ===== 外置存储同步（WebDAV / S3 兼容端点，数据级 JSON bundle） =====\n',
  '// ===== Books API =====\n',
  `// ===== Cloud Sync =====\nconst cloudTransports = createCloudTransports();\nconst cloudService = createCloudService({ db, rootDir: __dirname, transports: cloudTransports });\nregisterCloudRoutes(app, { cloudService });\n\n`,
  'cloud implementation and routes'
);

for (const forbidden of [
  'function getCloudConfig(',
  'function saveCloudConfig(',
  'function buildBundle(',
  'function backupPreRestore(',
  'function restoreBundle(',
  'function webdavAuthHeader(',
  'function s3Headers(',
  'function cloudAction(',
  'function versionPathFor(',
  'async function cloudTest(',
  "app.get('/api/cloud/config'",
  "app.put('/api/cloud/config'",
  "app.post('/api/cloud/test'",
  "app.post('/api/cloud/upload'",
  "app.get('/api/cloud/versions'",
  "app.post('/api/cloud/download'",
  "const fs = require('fs')",
  "const crypto = require('crypto')"
]) {
  if (server.includes(forbidden)) throw new Error(`Legacy cloud implementation remains: ${forbidden}`);
}

for (const required of [
  "require('./server/cloud-transports')",
  "require('./server/cloud-service')",
  "require('./server/cloud-routes')",
  'const cloudTransports = createCloudTransports();',
  'const cloudService = createCloudService({ db, rootDir: __dirname, transports: cloudTransports });',
  'registerCloudRoutes(app, { cloudService });'
]) {
  if (!server.includes(required)) throw new Error(`Missing cloud delegation: ${required}`);
}

const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
const cloudIndex = server.indexOf('registerCloudRoutes(app, { cloudService });');
const booksIndex = server.indexOf('registerBookRoutes(app, { booksService });');
if (!(authIndex >= 0 && cloudIndex > authIndex && booksIndex > cloudIndex)) {
  throw new Error('Cloud route registration order changed');
}

fs.writeFileSync(serverPath, server);
fs.writeFileSync(boundaryPath, `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');\nconst service = fs.readFileSync(new URL('../server/cloud-service.js', import.meta.url), 'utf8');\nconst transports = fs.readFileSync(new URL('../server/cloud-transports.js', import.meta.url), 'utf8');\nconst routes = fs.readFileSync(new URL('../server/cloud-routes.js', import.meta.url), 'utf8');\n\ntest('server composes cloud layers after global auth instead of owning cloud implementation', () => {\n  for (const marker of [\n    "require('./server/cloud-transports')",\n    "require('./server/cloud-service')",\n    "require('./server/cloud-routes')",\n    'createCloudTransports()',\n    'createCloudService({ db, rootDir: __dirname, transports: cloudTransports })',\n    'registerCloudRoutes(app, { cloudService })'\n  ]) assert.equal(server.includes(marker), true, marker);\n  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");\n  const cloudIndex = server.indexOf('registerCloudRoutes(app, { cloudService });');\n  const booksIndex = server.indexOf('registerBookRoutes(app, { booksService });');\n  assert.ok(authIndex >= 0 && cloudIndex > authIndex && booksIndex > cloudIndex);\n  for (const legacy of [\n    'function getCloudConfig(', 'function buildBundle(', 'function restoreBundle(',\n    'function webdavAuthHeader(', 'function s3Headers(', 'function cloudAction(',\n    "app.get('/api/cloud/config'", "app.post('/api/cloud/upload'", "app.post('/api/cloud/download'"\n  ]) assert.equal(server.includes(legacy), false, legacy);\n});\n\ntest('cloud service owns config, bundle, backup, restore and version lifecycle', () => {\n  for (const marker of [\n    'function getConfig()', 'function saveConfig(cfg)', 'function configure(body = {})',\n    'function buildBundle()', 'function backupPreRestore()', 'function restoreBundle(bundle)',\n    'function versionPathFor(cfg, timestamp)', 'async function upload()', 'async function download(versionPath)',\n    'PRE_RESTORE_BACKUP_LIMIT = 10', 'CLOUD_VERSION_LIMIT = 5'\n  ]) assert.equal(service.includes(marker), true, marker);\n});\n\ntest('cloud transports own WebDAV/S3 and routes own the six cloud endpoints', () => {\n  for (const marker of [\n    'function webdavAuthHeader(cfg)', 'function webdavPut(cfg, objectPath, body)',\n    'function s3Headers(cfg, method, objectPath, body, extraHeaders)', 'function s3Put(cfg, objectPath, body)',\n    'function action(cfg)', 'async function testConnection(cfg)'\n  ]) assert.equal(transports.includes(marker), true, marker);\n  for (const endpoint of [\n    '/api/cloud/config', '/api/cloud/test', '/api/cloud/upload', '/api/cloud/versions', '/api/cloud/download'\n  ]) assert.equal(routes.includes(endpoint), true, endpoint);\n});\n`);

console.log('Server cloud migration prepared.');
