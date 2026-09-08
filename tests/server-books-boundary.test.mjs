import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../server/books-service.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../server/books-routes.js', import.meta.url), 'utf8');

test('server delegates books and versions while preserving auth registration order', () => {
  for (const marker of [
    'createBooksService({ db, rootDir: __dirname })',
    'registerVersionRoutes(app, { authRequired, booksService })',
    'registerBookRoutes(app, { booksService })',
    'booksService.seedSampleIfEmpty()'
  ]) assert.equal(server.includes(marker), true, marker);
  const versionIndex = server.indexOf('registerVersionRoutes(app, { authRequired, booksService });');
  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
  const bookIndex = server.indexOf('registerBookRoutes(app, { booksService });');
  assert.ok(versionIndex >= 0 && authIndex > versionIndex && bookIndex > authIndex);
  for (const legacy of ['function snapshotVersion(', "app.get('/api/books/:id/versions'", "app.post('/api/books/:id/rollback'", "app.get('/api/books',", "app.put('/api/books/:id',", "app.delete('/api/books/:id',"]) {
    assert.equal(server.includes(legacy), false, legacy);
  }
});

test('books service owns persistence, version policy, delete backup and seed lifecycle', () => {
  for (const marker of [
    'function snapshotVersion(',
    'function rollbackVersion(',
    'function updateBook(',
    'function backupDeletedBook(',
    'function seedSampleIfEmpty()',
    'DEFAULT_MAX_AUTO_VERSIONS = 30',
    'DEFAULT_DELETED_BACKUP_LIMIT = 20',
    '回滚前快照'
  ]) assert.equal(service.includes(marker), true, marker);
});

test('books routes own HTTP mappings and keep version routes explicitly authenticated', () => {
  for (const marker of [
    '/api/books/:id/versions',
    '/api/books/:id/versions/:vid',
    '/api/books/:id/rollback',
    '/api/books',
    '/api/books/:id',
    "app.get('/api/books/:id/versions', authRequired",
    'status(409)',
    '数据已在其他设备/标签页被修改'
  ]) assert.equal(routes.includes(marker), true, marker);
});
