import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { registerSearchRoutes } = require('../server/search-routes.js');

function createAppRecorder() {
  const routes = [];
  const app = {
    post(path, ...handlers) {
      routes.push({ method: 'post', path, handlers });
      return app;
    }
  };
  return { app, routes };
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('search route keeps explicit auth middleware before the handler', () => {
  const { app, routes } = createAppRecorder();
  const authRequired = () => {};
  registerSearchRoutes(app, { authRequired, searchService: { search() {} } });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, '/api/proxy/search');
  assert.equal(routes[0].handlers.length, 2);
  assert.equal(routes[0].handlers[0], authRequired);
});

test('search route preserves trimming and missing/over-200 validation', async () => {
  const { app, routes } = createAppRecorder();
  const calls = [];
  registerSearchRoutes(app, {
    authRequired() {},
    searchService: { async search(query) { calls.push(query); return { results: [], source: 'none', limited: false }; } }
  });
  const handler = routes[0].handlers[1];

  for (const q of [undefined, '', '   ', 'x'.repeat(201)]) {
    const res = response();
    await handler({ body: q === undefined ? undefined : { q } }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: '缺少搜索词' });
  }

  const res = response();
  await handler({ body: { q: '  lore  ' } }, res);
  assert.deepEqual(calls, ['lore']);
  assert.deepEqual(res.body, { query: 'lore', results: [], source: 'none' });
});

test('search route maps source results, limited state and thrown upstream failures', async () => {
  const { app, routes } = createAppRecorder();
  let mode = 'bing';
  const searchService = {
    async search(query) {
      if (mode === 'throw') throw new Error('upstream down');
      if (mode === 'limited') return { query, results: [], source: 'none', limited: true };
      if (mode === 'ddg') return { query, results: [{ title: 'D' }], source: 'duckduckgo', limited: false };
      return { query, results: [{ title: 'B' }], source: 'bing', limited: false };
    }
  };
  registerSearchRoutes(app, { authRequired() {}, searchService });
  const handler = routes[0].handlers[1];

  let res = response();
  await handler({ body: { q: 'q' } }, res);
  assert.deepEqual(res.body, { query: 'q', results: [{ title: 'B' }], source: 'bing' });

  mode = 'ddg';
  res = response();
  await handler({ body: { q: 'q' } }, res);
  assert.deepEqual(res.body, { query: 'q', results: [{ title: 'D' }], source: 'duckduckgo' });

  mode = 'limited';
  res = response();
  await handler({ body: { q: 'q' } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: '搜索服务暂时被限流，请稍后再试' });

  mode = 'throw';
  res = response();
  await handler({ body: { q: 'q' } }, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: '搜索失败: upstream down' });
});
