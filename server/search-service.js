const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function decodeBingUrl(href) {
  try {
    const match = String(href).match(/[?&]u=([^&]+)/);
    if (match) {
      const b64 = decodeURIComponent(match[1]).replace(/^a1/, '');
      const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
      const url = Buffer.from(padded, 'base64').toString('utf8');
      if (url.startsWith('http')) return url;
    }
  } catch {}
  return href;
}

function decodeDdgUrl(href) {
  try {
    const match = String(href).match(/uddg=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : href;
  } catch {
    return href;
  }
}

function createSearchService({ fetchImpl = globalThis.fetch, userAgent = SEARCH_UA } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Search service requires fetch');

  async function searchBing(query) {
    const response = await fetchImpl('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-hans', {
      headers: { 'User-Agent': userAgent }
    });
    const html = await response.text();
    const results = [];
    const pattern = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/g;
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < 8) {
      const title = String(match[2] || '').replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
      const snippet = String(match[3] || '').replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
      if (title) results.push({ title, url: decodeBingUrl(match[1]), snippet });
    }
    return {
      results,
      limited: response.status === 429 || results.length === 0 && html.length < 30000
    };
  }

  async function searchDdg(query) {
    const response = await fetchImpl('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      headers: { 'User-Agent': userAgent }
    });
    const html = await response.text();
    const limited = response.status >= 400 || html.includes('anomaly') || html.includes('unusual traffic');
    const results = [];
    if (!limited) {
      const pattern = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      while ((match = pattern.exec(html)) !== null && results.length < 8) {
        const title = String(match[2] || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
        if (title) results.push({ title, url: decodeDdgUrl(match[1]), snippet: '' });
      }
    }
    return { results, limited };
  }

  async function search(query) {
    const bing = await searchBing(query);
    if (bing.results.length) return { query, results: bing.results, source: 'bing', limited: false };

    const ddg = await searchDdg(query);
    if (ddg.results.length) return { query, results: ddg.results, source: 'duckduckgo', limited: false };

    if (bing.limited || ddg.limited) {
      return { query, results: [], source: 'none', limited: true };
    }
    return { query, results: [], source: 'none', limited: false };
  }

  return { search, searchBing, searchDdg };
}

module.exports = {
  SEARCH_UA,
  createSearchService,
  decodeBingUrl,
  decodeDdgUrl
};
