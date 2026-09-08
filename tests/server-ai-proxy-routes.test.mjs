import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { registerAiProxyRoutes } = require('../server/ai-proxy-routes.js');

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

function routeOf(routes, path) {
  const route = routes.find(item => item.path === path);
  assert.ok(route, `missing POST ${path}`);
  return route;
}

function response() {
  const listeners = {};
  return {
    statusCode: 200,
    body: undefined,
    typeValue: undefined,
    headers: {},
    sent: undefined,
    ended: false,
    writableEnded: false,
    piped: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    type(value) { this.typeValue = value; return this; },
    send(value) { this.sent = value; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    end() { this.ended = true; this.writableEnded = true; },
    on(event, handler) { listeners[event] = handler; return this; },
    emit(event) { listeners[event]?.(); }
  };
}

class FakeAbortController {
  constructor() {
    this.signal = { aborted: false };
  }
  abort() {
    this.signal.aborted = true;
  }
}

const FakeReadable = {
  fromWeb(body) {
    return {
      pipe(target) {
        target.piped = true;
        target.pipedBody = body;
        return target;
      }
    };
  }
};

test('AI proxy routes keep models/chat endpoints without per-route auth middleware', () => {
  const { app, routes } = createAppRecorder();
  registerAiProxyRoutes(app, {
    aiProxyService: { fetchModels() {}, fetchChat() {} },
    AbortControllerImpl: FakeAbortController,
    ReadableImpl: FakeReadable
  });
  assert.deepEqual(routes.map(route => [route.path, route.handlers.length]), [
    ['/api/proxy/models', 1],
    ['/api/proxy/chat', 1]
  ]);
});

test('models route preserves validation, upstream status/raw JSON passthrough and 502 mapping', async () => {
  const { app, routes } = createAppRecorder();
  let mode = 'ok';
  const calls = [];
  const aiProxyService = {
    async fetchModels(url, key) {
      calls.push([url, key]);
      if (mode === 'throw') throw new Error('network');
      return { status: 207, async text() { return '{"data":[]}'; } };
    },
    fetchChat() {}
  };
  registerAiProxyRoutes(app, { aiProxyService, AbortControllerImpl: FakeAbortController, ReadableImpl: FakeReadable });
  const handler = routeOf(routes, '/api/proxy/models').handlers[0];

  for (const body of [undefined, {}, { url: 'x' }, { key: 'k' }]) {
    const res = response();
    await handler({ body }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: '缺少 url 或 key' });
  }

  let res = response();
  await handler({ body: { url: 'https://api.example.com', key: 'secret' } }, res);
  assert.deepEqual(calls, [['https://api.example.com', 'secret']]);
  assert.equal(res.statusCode, 207);
  assert.equal(res.typeValue, 'application/json');
  assert.equal(res.sent, '{"data":[]}');

  mode = 'throw';
  res = response();
  await handler({ body: { url: 'x', key: 'k' } }, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: '代理请求失败: network' });
});

test('chat route preserves validation, response headers, stream piping and empty-body end', async () => {
  const { app, routes } = createAppRecorder();
  let upstream = {
    status: 201,
    headers: { get(name) { return name === 'content-type' ? 'text/event-stream; charset=utf-8' : null; } },
    body: { stream: true }
  };
  const calls = [];
  const aiProxyService = {
    fetchModels() {},
    async fetchChat(url, key, body, signal) {
      calls.push([url, key, body, signal]);
      return upstream;
    }
  };
  registerAiProxyRoutes(app, { aiProxyService, AbortControllerImpl: FakeAbortController, ReadableImpl: FakeReadable });
  const handler = routeOf(routes, '/api/proxy/chat').handlers[0];

  for (const body of [undefined, {}, { url: 'x', key: 'k' }, { url: 'x', body: {} }, { key: 'k', body: {} }]) {
    const res = response();
    await handler({ body }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: '缺少 url / key / body' });
  }

  const requestBody = { model: 'x' };
  let res = response();
  await handler({ body: { url: 'u', key: 'k', body: requestBody } }, res);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'u');
  assert.equal(calls[0][1], 'k');
  assert.equal(calls[0][2], requestBody);
  assert.equal(calls[0][3].aborted, false);
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['Content-Type'], 'text/event-stream; charset=utf-8');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.piped, true);
  assert.equal(res.pipedBody, upstream.body);

  upstream = {
    status: 204,
    headers: { get() { return null; } },
    body: null
  };
  res = response();
  await handler({ body: { url: 'u', key: 'k', body: requestBody } }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.ended, true);
  assert.equal(res.piped, false);
});

test('chat close aborts unfinished upstream request but does not abort after response ended', async () => {
  const { app, routes } = createAppRecorder();
  const seenSignals = [];
  const aiProxyService = {
    fetchModels() {},
    async fetchChat(url, key, body, signal) {
      seenSignals.push(signal);
      return { status: 200, headers: { get() { return null; } }, body: null };
    }
  };
  registerAiProxyRoutes(app, { aiProxyService, AbortControllerImpl: FakeAbortController, ReadableImpl: FakeReadable });
  const handler = routeOf(routes, '/api/proxy/chat').handlers[0];

  let res = response();
  const pending = handler({ body: { url: 'u', key: 'k', body: {} } }, res);
  res.emit('close');
  await pending;
  assert.equal(seenSignals[0].aborted, true);

  res = response();
  res.writableEnded = true;
  const second = handler({ body: { url: 'u', key: 'k', body: {} } }, res);
  res.emit('close');
  await second;
  assert.equal(seenSignals[1].aborted, false);
});

test('aborted chat failures return silently while non-abort failures map to 502', async () => {
  const { app, routes } = createAppRecorder();
  let mode = 'abort';
  let activeRes;
  const aiProxyService = {
    fetchModels() {},
    async fetchChat() {
      if (mode === 'abort') activeRes.emit('close');
      throw new Error(mode === 'abort' ? 'aborted upstream' : 'network');
    }
  };
  registerAiProxyRoutes(app, { aiProxyService, AbortControllerImpl: FakeAbortController, ReadableImpl: FakeReadable });
  const handler = routeOf(routes, '/api/proxy/chat').handlers[0];

  activeRes = response();
  await handler({ body: { url: 'u', key: 'k', body: {} } }, activeRes);
  assert.equal(activeRes.statusCode, 200);
  assert.equal(activeRes.body, undefined);

  mode = 'network';
  activeRes = response();
  await handler({ body: { url: 'u', key: 'k', body: {} } }, activeRes);
  assert.equal(activeRes.statusCode, 502);
  assert.deepEqual(activeRes.body, { error: '代理请求失败: network' });
});
