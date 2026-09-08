import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SEARCH_UA, createSearchService, decodeBingUrl, decodeDdgUrl } = require('../server/search-service.js');

function response(status, html) {
  return { status, async text() { return html; } };
}

function bingItem(url, title, snippet = '') {
  return `<li class="b_algo"><h2><a href="${url}">${title}</a></h2><p>${snippet}</p></li>`;
}

function ddgItem(url, title) {
  return `<a class="result__a" href="${url}">${title}</a>`;
}

test('URL decoders preserve Bing a1/base64 and DDG uddg behavior', () => {
  const target = 'https://example.com/a?b=1';
  const encoded = Buffer.from(target).toString('base64').replace(/=+$/, '');
  assert.equal(decodeBingUrl('https://www.bing.com/ck/a?u=a1' + encoded + '&x=1'), target);
  assert.equal(decodeBingUrl('https://plain.example/path'), 'https://plain.example/path');
  assert.equal(decodeDdgUrl('https://duckduckgo.com/l/?uddg=' + encodeURIComponent(target) + '&rut=x'), target);
  assert.equal(decodeDdgUrl('https://plain.example/path'), 'https://plain.example/path');
});

test('Bing parser keeps user agent, HTML cleanup, decoded URL, eight-result cap and limited heuristic', async () => {
  const calls = [];
  const target = 'https://example.com/decoded';
  const encoded = Buffer.from(target).toString('base64').replace(/=+$/, '');
  const html = Array.from({ length: 10 }, (_, index) => bingItem(
    index === 0 ? 'https://bing.com/ck/a?u=a1' + encoded : 'https://example.com/' + index,
    `<strong>Title ${index}</strong>`,
    `Snippet &amp; ${index}`
  )).join('');
  const service = createSearchService({
    fetchImpl: async (url, options) => { calls.push([url, options]); return response(200, html); }
  });
  const result = await service.searchBing('hello world');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://www.bing.com/search?q=hello%20world&setlang=zh-hans');
  assert.equal(calls[0][1].headers['User-Agent'], SEARCH_UA);
  assert.equal(result.results.length, 8);
  assert.equal(result.results[0].title, 'Title 0');
  assert.equal(result.results[0].url, target);
  assert.equal(result.results[0].snippet, 'Snippet   0');
  assert.equal(result.limited, false);

  const limited = createSearchService({ fetchImpl: async () => response(429, '') });
  assert.deepEqual(await limited.searchBing('x'), { results: [], limited: true });

  const shortEmpty = createSearchService({ fetchImpl: async () => response(200, '<html></html>') });
  assert.deepEqual(await shortEmpty.searchBing('x'), { results: [], limited: true });

  const longEmpty = createSearchService({ fetchImpl: async () => response(200, 'x'.repeat(30000)) });
  assert.deepEqual(await longEmpty.searchBing('x'), { results: [], limited: false });
});

test('DDG parser preserves limited detection, redirect decoding and eight-result cap', async () => {
  const target = 'https://example.org/result';
  const html = Array.from({ length: 9 }, (_, index) => ddgItem(
    index === 0 ? 'https://duckduckgo.com/l/?uddg=' + encodeURIComponent(target) : 'https://example.org/' + index,
    `<b>Result ${index}</b>`
  )).join('');
  const service = createSearchService({ fetchImpl: async () => response(200, html) });
  const result = await service.searchDdg('x');
  assert.equal(result.results.length, 8);
  assert.equal(result.results[0].title, 'Result 0');
  assert.equal(result.results[0].url, target);
  assert.equal(result.results[0].snippet, '');
  assert.equal(result.limited, false);

  for (const body of ['anomaly challenge', 'unusual traffic detected']) {
    const limited = createSearchService({ fetchImpl: async () => response(200, body) });
    assert.deepEqual(await limited.searchDdg('x'), { results: [], limited: true });
  }
  const statusLimited = createSearchService({ fetchImpl: async () => response(403, html) });
  assert.deepEqual(await statusLimited.searchDdg('x'), { results: [], limited: true });
});

test('search orchestration keeps Bing primary, DDG fallback, limited and empty-source semantics', async () => {
  let calls = [];
  let service = createSearchService({
    fetchImpl: async url => {
      calls.push(url);
      if (url.includes('bing.com')) return response(200, bingItem('https://b.example', 'Bing'));
      throw new Error('DDG should not be called');
    }
  });
  assert.deepEqual(await service.search('q'), {
    query: 'q',
    results: [{ title: 'Bing', url: 'https://b.example', snippet: '' }],
    source: 'bing',
    limited: false
  });
  assert.equal(calls.length, 1);

  calls = [];
  service = createSearchService({
    fetchImpl: async url => {
      calls.push(url);
      if (url.includes('bing.com')) return response(200, 'x'.repeat(30000));
      return response(200, ddgItem('https://d.example', 'DDG'));
    }
  });
  assert.deepEqual(await service.search('q'), {
    query: 'q',
    results: [{ title: 'DDG', url: 'https://d.example', snippet: '' }],
    source: 'duckduckgo',
    limited: false
  });
  assert.equal(calls.length, 2);

  service = createSearchService({
    fetchImpl: async url => url.includes('bing.com')
      ? response(429, '')
      : response(200, 'x'.repeat(30000))
  });
  assert.deepEqual(await service.search('q'), { query: 'q', results: [], source: 'none', limited: true });

  service = createSearchService({ fetchImpl: async () => response(200, 'x'.repeat(30000)) });
  assert.deepEqual(await service.search('q'), { query: 'q', results: [], source: 'none', limited: false });
});
