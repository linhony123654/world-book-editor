import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../server/ai-data-service.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../server/ai-data-routes.js', import.meta.url), 'utf8');

test('server delegates AI data persistence after global auth middleware', () => {
  for (const marker of [
    "require('./server/ai-data-service')",
    "require('./server/ai-data-routes')",
    'createAiDataService({ db })',
    'registerAiDataRoutes(app, { aiDataService })'
  ]) assert.equal(server.includes(marker), true, marker);
  const authIndex = server.indexOf("app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);");
  const aiDataIndex = server.indexOf('registerAiDataRoutes(app, { aiDataService });');
  assert.ok(authIndex >= 0 && aiDataIndex > authIndex);
  for (const legacy of [
    "app.get('/api/ai-data/:bookId'",
    "app.put('/api/ai-data/:bookId'",
    'SELECT memory, sessions, active_session FROM ai_data WHERE book_id = ?'
  ]) assert.equal(server.includes(legacy), false, legacy);
});

test('AI data service owns JSON tolerance and partial UPSERT semantics', () => {
  for (const marker of [
    'function parseJsonOrNull(',
    'function isValidBookId(',
    'function get(bookId)',
    'function update(bookId, body = {})',
    "Object.prototype.hasOwnProperty.call(body, 'memory')",
    "Object.prototype.hasOwnProperty.call(body, 'sessions')",
    "Object.prototype.hasOwnProperty.call(body, 'activeSession')",
    'ON CONFLICT(book_id) DO UPDATE SET'
  ]) assert.equal(service.includes(marker), true, marker);
});

test('AI data routes own current HTTP mappings without per-route auth', () => {
  for (const marker of [
    "app.get('/api/ai-data/:bookId'",
    "app.put('/api/ai-data/:bookId'",
    "{ error: 'invalid bookId' }",
    "{ error: 'no fields' }"
  ]) assert.equal(routes.includes(marker), true, marker);
});
