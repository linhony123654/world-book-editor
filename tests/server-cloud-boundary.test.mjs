import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../server/cloud-service.js', import.meta.url), 'utf8');
const transports = fs.readFileSync(new URL('../server/cloud-transports.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../server/cloud-routes.js', import.meta.url), 'utf8');

test('server composes cloud layers after global auth instead of owning cloud implementation', () => {
  for (const marker of [
    "require('./server/cloud-transports')",
    "require('./server/cloud-service')",
    "require('./server/cloud-routes')",
    'createCloudTransports()',
    'createCloudService({ db, rootDir: __dirname, transports: cloudTransports })',
    'registerCloudRoutes(app, { cloudService })'
  ]) assert.equal(server.includes(marker), true, marker);
  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
  const cloudIndex = server.indexOf('registerCloudRoutes(app, { cloudService });');
  const booksIndex = server.indexOf('registerBookRoutes(app, { booksService });');
  assert.ok(authIndex >= 0 && cloudIndex > authIndex && booksIndex > cloudIndex);
  for (const legacy of [
    'function getCloudConfig(', 'function buildBundle(', 'function restoreBundle(',
    'function webdavAuthHeader(', 'function s3Headers(', 'function cloudAction(',
    "app.get('/api/cloud/config'", "app.post('/api/cloud/upload'", "app.post('/api/cloud/download'"
  ]) assert.equal(server.includes(legacy), false, legacy);
});

test('cloud service owns config, bundle, backup, restore and version lifecycle', () => {
  for (const marker of [
    'function getConfig()', 'function saveConfig(cfg)', 'function configure(body = {})',
    'function buildBundle()', 'function backupPreRestore()', 'function restoreBundle(bundle)',
    'function versionPathFor(cfg, timestamp)', 'async function upload()', 'async function download(versionPath)',
    'PRE_RESTORE_BACKUP_LIMIT = 10', 'CLOUD_VERSION_LIMIT = 5'
  ]) assert.equal(service.includes(marker), true, marker);
});

test('cloud transports own WebDAV/S3 and routes own the six cloud endpoints', () => {
  for (const marker of [
    'function webdavAuthHeader(cfg)', 'function webdavPut(cfg, objectPath, body)',
    'function s3Headers(cfg, method, objectPath, body, extraHeaders)', 'function s3Put(cfg, objectPath, body)',
    'function action(cfg)', 'async function testConnection(cfg)'
  ]) assert.equal(transports.includes(marker), true, marker);
  for (const endpoint of [
    '/api/cloud/config', '/api/cloud/test', '/api/cloud/upload', '/api/cloud/versions', '/api/cloud/download'
  ]) assert.equal(routes.includes(endpoint), true, endpoint);
});
