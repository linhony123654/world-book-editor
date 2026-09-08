import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { registerBookRoutes, registerVersionRoutes } = require('../server/books-routes.js');

function createAppRecorder() {
  const routes = [];
  const app = {};
  for (const method of ['get', 'post', 'put', 'delete']) {
    app[method] = (path, ...handlers) => {
      routes.push({ method, path, handlers });
      return app;
    };
  }
  return { app, routes };
}

function routeOf(routes, method, path) {
  const route = routes.find(item => item.method === method && item.path === path);
  assert.ok(route, `missing ${method.toUpperCase()} ${path}`);
  return route;
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('version routes keep explicit auth middleware and current endpoint set', () => {
  const { app, routes } = createAppRecorder();
  const authRequired = () => {};
  const booksService = {
    listVersions() {}, getVersion() {}, rollbackVersion() {}
  };
  registerVersionRoutes(app, { authRequired, booksService });

  assert.deepEqual(routes.map(route => [route.method, route.path]), [
    ['get', '/api/books/:id/versions'],
    ['get', '/api/books/:id/versions/:vid'],
    ['post', '/api/books/:id/rollback']
  ]);
  for (const route of routes) {
    assert.equal(route.handlers.length, 2);
    assert.equal(route.handlers[0], authRequired);
  }
});

test('version route handlers preserve list, missing version and rollback response contracts', () => {
  const calls = [];
  const { app, routes } = createAppRecorder();
  const authRequired = () => {};
  const booksService = {
    listVersions(bookId) { calls.push(['list', bookId]); return [{ id: 1 }]; },
    getVersion(bookId, versionId) {
      calls.push(['get', bookId, versionId]);
      return versionId === 'missing' ? null : { id: Number(versionId), data: { entries: {} } };
    },
    rollbackVersion(bookId, versionId) {
      calls.push(['rollback', bookId, versionId]);
      return versionId === 0 ? null : { entry_count: 7 };
    }
  };
  registerVersionRoutes(app, { authRequired, booksService });

  let res = createResponse();
  routeOf(routes, 'get', '/api/books/:id/versions').handlers[1]({ params: { id: '9' } }, res);
  assert.deepEqual(res.body, [{ id: 1 }]);

  res = createResponse();
  routeOf(routes, 'get', '/api/books/:id/versions/:vid').handlers[1]({ params: { id: '9', vid: 'missing' } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: '版本不存在' });

  res = createResponse();
  routeOf(routes, 'post', '/api/books/:id/rollback').handlers[1]({ params: { id: '9' }, body: { vid: 12, note: '  manual note  ' } }, res);
  assert.deepEqual(res.body, { ok: true, entry_count: 7, note: 'manual note' });

  res = createResponse();
  routeOf(routes, 'post', '/api/books/:id/rollback').handlers[1]({ params: { id: '9' }, body: { vid: 13 } }, res);
  assert.deepEqual(res.body, { ok: true, entry_count: 7, note: '回滚到版本 #13' });

  res = createResponse();
  routeOf(routes, 'post', '/api/books/:id/rollback').handlers[1]({ params: { id: '9' }, body: { vid: 0 } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: '版本不存在' });

  assert.deepEqual(calls, [
    ['list', '9'],
    ['get', '9', 'missing'],
    ['rollback', '9', 12],
    ['rollback', '9', 13],
    ['rollback', '9', 0]
  ]);
});

test('book routes keep CRUD endpoints without per-route auth middleware', () => {
  const { app, routes } = createAppRecorder();
  const booksService = {
    listBooks() {}, getBook() {}, createBook() {}, updateBook() {}, deleteBook() {}
  };
  registerBookRoutes(app, { booksService });

  assert.deepEqual(routes.map(route => [route.method, route.path]), [
    ['get', '/api/books'],
    ['get', '/api/books/:id'],
    ['post', '/api/books'],
    ['put', '/api/books/:id'],
    ['delete', '/api/books/:id']
  ]);
  for (const route of routes) assert.equal(route.handlers.length, 1);
});

test('book route handlers preserve invalid, missing, conflict and success mappings', () => {
  const { app, routes } = createAppRecorder();
  const booksService = {
    listBooks() { return [{ id: 1 }]; },
    getBook(id) { return id === 'missing' ? null : { id: Number(id), name: 'Lore' }; },
    createBook(name, data) { return data ? { id: 2, entry_count: 1 } : { error: 'invalid_data' }; },
    updateBook(id, body) {
      if (id === 'missing') return { error: 'not_found' };
      if (!body.data) return { error: 'invalid_data' };
      if (body.conflict) return { error: 'conflict', serverUpdatedAt: '2026-01-01 00:00:00' };
      return { ok: true, entry_count: 3, updated_at: '2026-01-02 00:00:00' };
    },
    deleteBook(id) { return id !== 'missing'; }
  };
  registerBookRoutes(app, { booksService });

  let res = createResponse();
  routeOf(routes, 'get', '/api/books').handlers[0]({}, res);
  assert.deepEqual(res.body, [{ id: 1 }]);

  res = createResponse();
  routeOf(routes, 'get', '/api/books/:id').handlers[0]({ params: { id: 'missing' } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'not found' });

  res = createResponse();
  routeOf(routes, 'post', '/api/books').handlers[0]({ body: { name: 'x', data: null } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'invalid data' });

  res = createResponse();
  routeOf(routes, 'put', '/api/books/:id').handlers[0]({ params: { id: 'missing' }, body: { data: {} } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'not found' });

  res = createResponse();
  routeOf(routes, 'put', '/api/books/:id').handlers[0]({ params: { id: '1' }, body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'invalid data' });

  res = createResponse();
  routeOf(routes, 'put', '/api/books/:id').handlers[0]({ params: { id: '1' }, body: { data: {}, conflict: true } }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    error: 'conflict',
    message: '数据已在其他设备/标签页被修改',
    serverUpdatedAt: '2026-01-01 00:00:00'
  });

  res = createResponse();
  routeOf(routes, 'put', '/api/books/:id').handlers[0]({ params: { id: '1' }, body: { data: {} } }, res);
  assert.deepEqual(res.body, { ok: true, entry_count: 3, updated_at: '2026-01-02 00:00:00' });

  res = createResponse();
  routeOf(routes, 'delete', '/api/books/:id').handlers[0]({ params: { id: 'missing' } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'not found' });

  res = createResponse();
  routeOf(routes, 'delete', '/api/books/:id').handlers[0]({ params: { id: '1' } }, res);
  assert.deepEqual(res.body, { ok: true });
});
