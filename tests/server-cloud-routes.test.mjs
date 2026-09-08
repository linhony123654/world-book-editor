import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { registerCloudRoutes } = require('../server/cloud-routes.js');

function createAppRecorder() {
  const routes = [];
  const app = {};
  for (const method of ['get', 'put', 'post']) {
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

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('cloud routes keep current endpoint set without per-route auth middleware', () => {
  const { app, routes } = createAppRecorder();
  const cloudService = {
    getConfig() {}, configure() {}, testConnection() {}, upload() {}, listVersions() {}, download() {}
  };
  registerCloudRoutes(app, { cloudService });
  assert.deepEqual(routes.map(route => [route.method, route.path, route.handlers.length]), [
    ['get', '/api/cloud/config', 1],
    ['put', '/api/cloud/config', 1],
    ['post', '/api/cloud/test', 1],
    ['post', '/api/cloud/upload', 1],
    ['get', '/api/cloud/versions', 1],
    ['post', '/api/cloud/download', 1]
  ]);
});

test('config routes preserve default response and request-body delegation', () => {
  const { app, routes } = createAppRecorder();
  const calls = [];
  let config = null;
  const cloudService = {
    getConfig() { return config; },
    configure(body) { calls.push(body); return { ok: true }; },
    testConnection() {}, upload() {}, listVersions() {}, download() {}
  };
  registerCloudRoutes(app, { cloudService });

  let res = response();
  routeOf(routes, 'get', '/api/cloud/config').handlers[0]({}, res);
  assert.deepEqual(res.body, { provider: 'webdav', remote_path: 'world-books-backup.json' });

  config = { provider: 's3', remote_path: 'x.json' };
  res = response();
  routeOf(routes, 'get', '/api/cloud/config').handlers[0]({}, res);
  assert.deepEqual(res.body, config);

  res = response();
  routeOf(routes, 'put', '/api/cloud/config').handlers[0]({ body: { provider: 's3' } }, res);
  assert.deepEqual(calls, [{ provider: 's3' }]);
  assert.deepEqual(res.body, { ok: true });
});

test('test route maps missing config to 400 and otherwise returns transport result', async () => {
  const { app, routes } = createAppRecorder();
  let result = { error: 'not_configured' };
  const cloudService = {
    getConfig() {}, configure() {}, async testConnection() { return result; }, upload() {}, listVersions() {}, download() {}
  };
  registerCloudRoutes(app, { cloudService });
  const handler = routeOf(routes, 'post', '/api/cloud/test').handlers[0];

  let res = response();
  await handler({}, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: '尚未配置外置存储' });

  result = { ok: false, error: 'WebDAV 认证失败（401）' };
  res = response();
  await handler({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, result);
});

test('upload route preserves missing-config 400, success and transport-error 502 mappings', async () => {
  const { app, routes } = createAppRecorder();
  let mode = 'missing';
  const cloudService = {
    getConfig() {}, configure() {}, testConnection() {}, listVersions() {}, download() {},
    async upload() {
      if (mode === 'missing') return { error: 'not_configured' };
      if (mode === 'throw') throw new Error('network');
      return { ok: true, books: 2, exportedAt: 'x', versionPath: 'v.json' };
    }
  };
  registerCloudRoutes(app, { cloudService });
  const handler = routeOf(routes, 'post', '/api/cloud/upload').handlers[0];

  let res = response();
  await handler({}, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: '尚未配置外置存储' });

  mode = 'ok';
  res = response();
  await handler({}, res);
  assert.deepEqual(res.body, { ok: true, books: 2, exportedAt: 'x', versionPath: 'v.json' });

  mode = 'throw';
  res = response();
  await handler({}, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: '上传失败: network' });
});

test('versions and download routes preserve response shape and 400/502 mappings', async () => {
  const { app, routes } = createAppRecorder();
  let mode = 'missing';
  const calls = [];
  const cloudService = {
    getConfig() {}, configure() {}, testConnection() {}, upload() {},
    listVersions() { return [{ path: 'v.json', uploaded_at: 'today' }]; },
    async download(versionPath) {
      calls.push(versionPath);
      if (mode === 'missing') return { error: 'not_configured' };
      if (mode === 'throw') throw new Error('bad json');
      return { ok: true, books: 1, ai: 2, exportedAt: null };
    }
  };
  registerCloudRoutes(app, { cloudService });

  let res = response();
  routeOf(routes, 'get', '/api/cloud/versions').handlers[0]({}, res);
  assert.deepEqual(res.body, { versions: [{ path: 'v.json', uploaded_at: 'today' }] });

  const handler = routeOf(routes, 'post', '/api/cloud/download').handlers[0];
  res = response();
  await handler({ body: { versionPath: 'picked.json' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: '尚未配置外置存储' });

  mode = 'ok';
  res = response();
  await handler({ body: {} }, res);
  assert.deepEqual(res.body, { ok: true, books: 1, ai: 2, exportedAt: null });

  mode = 'throw';
  res = response();
  await handler({ body: { versionPath: 'bad.json' } }, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: '拉取失败: bad json' });
  assert.deepEqual(calls, ['picked.json', undefined, 'bad.json']);
});
