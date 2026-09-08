import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createAiProxyService, normalizeBase } = require('../server/ai-proxy-service.js');

test('normalizeBase preserves current v1 endpoint normalization rules', () => {
  assert.equal(normalizeBase(' https://api.example.com/ '), 'https://api.example.com/v1');
  assert.equal(normalizeBase('https://api.example.com/v1'), 'https://api.example.com/v1');
  assert.equal(normalizeBase('https://api.example.com/v1/'), 'https://api.example.com/v1');
  assert.equal(normalizeBase('https://api.example.com/v1/models'), 'https://api.example.com/v1');
  assert.equal(normalizeBase('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1');
  assert.equal(normalizeBase('https://api.example.com/chat/completions'), 'https://api.example.com/v1');
  assert.equal(normalizeBase(''), '/v1');
});

test('fetchModels keeps bearer auth and normalized models endpoint', async () => {
  const calls = [];
  const upstream = { status: 200 };
  const service = createAiProxyService({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return upstream;
    }
  });
  assert.equal(await service.fetchModels('https://api.example.com/v1/models', 'secret'), upstream);
  assert.deepEqual(calls, [[
    'https://api.example.com/v1/models',
    { headers: { Authorization: 'Bearer secret' } }
  ]]);
});

test('fetchChat keeps POST JSON body, bearer auth and caller AbortSignal', async () => {
  const calls = [];
  const signal = { id: 'signal' };
  const body = { model: 'x', messages: [{ role: 'user', content: 'hi' }] };
  const upstream = { status: 200 };
  const service = createAiProxyService({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return upstream;
    }
  });
  assert.equal(await service.fetchChat('https://api.example.com/', 'key', body, signal), upstream);
  assert.deepEqual(calls, [[
    'https://api.example.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer key' },
      body: JSON.stringify(body),
      signal
    }
  ]]);
});
