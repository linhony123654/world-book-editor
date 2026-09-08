// Web-search tool adapter. Keeps auth/HTTP concerns outside the chat controller.

export function createWebSearchTool({
  fetchImpl = globalThis.fetch,
  getAuthHeaders = () => ({}),
  endpoint = '/api/proxy/search'
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  return async function webSearch({ query, limit } = {}) {
    const q = String(query || '').trim();
    if (!q) return { summary: '缺少搜索词', detail: '请提供要搜索的内容' };

    const authHeaders = await getAuthHeaders();
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authHeaders || {}) },
      body: JSON.stringify({ q })
    });

    if (response.status === 503) {
      return {
        summary: '搜索服务被限流',
        detail: '搜索服务暂时被限流（反爬），请稍后重试或换关键词。你可以先用现有知识创作，稍后再补查。'
      };
    }
    if (!response.ok) throw new Error('搜索接口 HTTP ' + response.status);

    const data = await response.json();
    const maxResults = Math.max(1, Math.min(parseInt(limit, 10) || 3, 5));
    const results = (data.results || []).slice(0, maxResults);
    if (!results.length) {
      return { summary: '搜索无结果', detail: '「' + q + '」没有找到结果，可换关键词重试' };
    }

    const lines = results.map((result, index) =>
      (index + 1) + '. ' + result.title + '\n   ' + result.url + '\n   ' + (result.snippet || '(无摘要)')
    );
    return {
      summary: '搜索到 ' + results.length + ' 条（' + q + '）',
      detail: lines.join('\n\n')
    };
  };
}
