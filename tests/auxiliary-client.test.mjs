import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuxiliaryCompletionClient } from '../public/modules/ai/auxiliary-client.js';

async function* chunks(...values) {
  for (const value of values) yield value;
}

test('auxiliary client aggregates streamed content and trims the result', async () => {
  const calls = [];
  const client = createAuxiliaryCompletionClient({
    getConfig: () => ({ apiUrl: 'https://example.test/v1', apiKey: 'k', model: 'm1' }),
    streamRequest: async (url, key, body, signal) => {
      calls.push({ url, key, body, signal });
      return { id: 'response' };
    },
    parseStream: () => chunks(
      { choices: [{ delta: { content: '  你' } }] },
      { choices: [{ delta: { content: '好  ' } }] },
      { choices: [{ delta: {} }] }
    ),
    setTimer: () => 1,
    clearTimer: () => {}
  });

  const messages = [{ role: 'user', content: 'hi' }];
  assert.equal(await client.complete(messages), '你好');
  assert.equal(calls[0].url, 'https://example.test/v1');
  assert.equal(calls[0].key, 'k');
  assert.equal(calls[0].body.model, 'm1');
  assert.equal(calls[0].body.messages, messages);
});

test('per-call overrides win over configured endpoint/model credentials', async () => {
  let seen;
  const client = createAuxiliaryCompletionClient({
    getConfig: () => ({ apiUrl: 'base', apiKey: 'base-key', model: 'base-model' }),
    streamRequest: async (...args) => {
      seen = args;
      return {};
    },
    parseStream: () => chunks(),
    setTimer: () => 1,
    clearTimer: () => {}
  });

  await client.complete([], { apiUrl: 'override', apiKey: 'override-key', model: 'override-model' });
  assert.equal(seen[0], 'override');
  assert.equal(seen[1], 'override-key');
  assert.equal(seen[2].model, 'override-model');
});

test('missing API configuration fails before transport', async () => {
  let called = false;
  const client = createAuxiliaryCompletionClient({
    getConfig: () => ({ model: 'm' }),
    streamRequest: async () => { called = true; return {}; },
    parseStream: () => chunks()
  });

  await assert.rejects(() => client.complete([]), /未配置 API/);
  assert.equal(called, false);
});

test('timeout aborts the request and timer is cleared after failure', async () => {
  let aborted = false;
  let cleared = false;
  class FakeAbortController {
    constructor() {
      this.signal = { aborted: false };
    }
    abort() {
      aborted = true;
      this.signal.aborted = true;
    }
  }

  const client = createAuxiliaryCompletionClient({
    getConfig: () => ({ apiUrl: 'u', apiKey: 'k' }),
    AbortControllerImpl: FakeAbortController,
    setTimer: fn => { fn(); return 77; },
    clearTimer: id => { assert.equal(id, 77); cleared = true; },
    streamRequest: async (_url, _key, _body, signal) => {
      assert.equal(signal.aborted, true);
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    },
    parseStream: () => chunks()
  });

  await assert.rejects(() => client.complete([]), error => error.name === 'AbortError');
  assert.equal(aborted, true);
  assert.equal(cleared, true);
});

test('timer is cleared on successful completion', async () => {
  let cleared = false;
  const client = createAuxiliaryCompletionClient({
    getConfig: () => ({ apiUrl: 'u', apiKey: 'k' }),
    streamRequest: async () => ({}),
    parseStream: () => chunks({ choices: [{ delta: { content: 'ok' } }] }),
    setTimer: () => 42,
    clearTimer: id => { assert.equal(id, 42); cleared = true; }
  });

  assert.equal(await client.complete([]), 'ok');
  assert.equal(cleared, true);
});
