import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { registerAiDataRoutes } = require('../server/ai-data-routes.js');

function createAppRecorder() {
  const routes = [];
  const app = {};
  for (const method of ['get', 'put']) {
    app[method] = (path, ...handlers) => {
      routes.push({ method, path, handlers });
      return app;
    };
  }
  return { app, routes };
}

function routeOf(routes, method) {
  const route = routes.find(item => item.method === method && item.path === '/api/ai-data/:bookId');
  assert.ok(route, `missing ${method.toUpperCase()} /api/ai-data/:bookId`);
  return route;
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('AI data routes keep GET/PUT endpoints without per-route auth middleware', () => {
  const { app, routes } = createAppRecorder();
  const aiDataService = { get() {}, update() {} };
  registerAiDataRoutes(app, { aiDataService });
  assert.deepEqual(routes.map(route => [route.method, route.path, route.handlers.length]), [
    ['get', '/api/ai-data/:bookId', 1],
    ['put', '/api/ai-data/:bookId', 1]
  ]);
});

test('GET delegates directly to persistence service and preserves empty-shape responses', () => {
  const { app, routes } = createAppRecorder();
  const calls = [];
  const aiDataService = {
    get(bookId) {
      calls.push(bookId);
      return { memory: null, sessions: null, activeSession: null };
    },
    update() {}
  };
  registerAiDataRoutes(app, { aiDataService });
  const res = response();
  routeOf(routes, 'get').handlers[0]({ params: { bookId: 'bad' } }, res);
  assert.deepEqual(calls, ['bad']);
  assert.deepEqual(res.body, { memory: null, sessions: null, activeSession: null });
});

test('PUT preserves invalid id, no-fields and success HTTP mappings', () => {
  const { app, routes } = createAppRecorder();
  const calls = [];
  const aiDataService = {
    get() {},
    update(bookId, body) {
      calls.push([bookId, body]);
      if (bookId === 'bad') return { error: 'invalid_book_id' };
      if (!Object.keys(body).length) return { error: 'no_fields' };
      return { ok: true };
    }
  };
  registerAiDataRoutes(app, { aiDataService });
  const handler = routeOf(routes, 'put').handlers[0];

  let res = response();
  handler({ params: { bookId: 'bad' }, body: { memory: {} } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'invalid bookId' });

  res = response();
  handler({ params: { bookId: '1' }, body: undefined }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'no fields' });

  res = response();
  handler({ params: { bookId: '1' }, body: { activeSession: 0 } }, res);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(calls, [
    ['bad', { memory: {} }],
    ['1', {}],
    ['1', { activeSession: 0 }]
  ]);
});
