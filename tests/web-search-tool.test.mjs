import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebSearchTool } from '../public/modules/ai/tools/web-search.js';

function response({ status = 200, data = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return data; }
  };
}

test('web search rejects empty query before network access', async () => {
  let calls = 0;
  const search = createWebSearchTool({ fetchImpl: async () => { calls++; } });
  assert.deepEqual(await search({ query: '   ' }), {
    summary: '缺少搜索词',
    detail: '请提供要搜索的内容'
  });
  assert.equal(calls, 0);
});

test('web search preserves request shape, auth headers and default result limit', async () => {
  const calls = [];
  const search = createWebSearchTool({
    getAuthHeaders: async () => ({ Authorization: 'Bearer x' }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({
        data: {
          results: Array.from({ length: 4 }, (_, i) => ({
            title: 'T' + i,
            url: 'https://example.com/' + i,
            snippet: 'S' + i
          }))
        }
      });
    }
  });

  const result = await search({ query: ' lore ' });
  assert.equal(calls[0].url, '/api/proxy/search');
  assert.deepEqual(calls[0].init.headers, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer x'
  });
  assert.equal(calls[0].init.body, JSON.stringify({ q: 'lore' }));
  assert.equal(result.summary, '搜索到 3 条（lore）');
  assert.doesNotMatch(result.detail, /T3/);
});

test('web search clamps explicit result limit to 1..5', async () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ title: 'T' + i, url: 'u' + i, snippet: '' }));
  const search = createWebSearchTool({ fetchImpl: async () => response({ data: { results: items } }) });

  assert.match((await search({ query: 'x', limit: 99 })).summary, /搜索到 5 条/);
  assert.match((await search({ query: 'x', limit: -10 })).summary, /搜索到 1 条/);
});

test('503 keeps the legacy anti-rate-limit guidance', async () => {
  const search = createWebSearchTool({ fetchImpl: async () => response({ status: 503 }) });
  const result = await search({ query: 'x' });
  assert.equal(result.summary, '搜索服务被限流');
  assert.match(result.detail, /稍后重试/);
});

test('non-503 HTTP errors stay exceptional for safe executor isolation', async () => {
  const search = createWebSearchTool({ fetchImpl: async () => response({ status: 502 }) });
  await assert.rejects(() => search({ query: 'x' }), /搜索接口 HTTP 502/);
});

test('empty results preserve the legacy user-facing result', async () => {
  const search = createWebSearchTool({ fetchImpl: async () => response({ data: { results: [] } }) });
  assert.deepEqual(await search({ query: 'nothing' }), {
    summary: '搜索无结果',
    detail: '「nothing」没有找到结果，可换关键词重试'
  });
});
