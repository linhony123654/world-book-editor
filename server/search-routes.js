function registerSearchRoutes(app, { authRequired, searchService } = {}) {
  if (!app) throw new TypeError('Search routes require app');
  if (typeof authRequired !== 'function') throw new TypeError('Search routes require authRequired');
  if (!searchService) throw new TypeError('Search routes require searchService');

  app.post('/api/proxy/search', authRequired, async (req, res) => {
    const query = String((req.body || {}).q || '').trim();
    if (!query || query.length > 200) return res.status(400).json({ error: '缺少搜索词' });
    try {
      const result = await searchService.search(query);
      if (result.limited) return res.status(503).json({ error: '搜索服务暂时被限流，请稍后再试' });
      res.json({ query, results: result.results, source: result.source });
    } catch (error) {
      res.status(502).json({ error: '搜索失败: ' + error.message });
    }
  });
}

module.exports = { registerSearchRoutes };
