const { Readable } = require('stream');

function registerAiProxyRoutes(app, {
  aiProxyService,
  AbortControllerImpl = globalThis.AbortController,
  ReadableImpl = Readable
} = {}) {
  if (!app) throw new TypeError('AI proxy routes require app');
  if (!aiProxyService) throw new TypeError('AI proxy routes require aiProxyService');
  if (typeof AbortControllerImpl !== 'function') throw new TypeError('AI proxy routes require AbortController');

  app.post('/api/proxy/models', async (req, res) => {
    const { url, key } = req.body || {};
    if (!url || !key) return res.status(400).json({ error: '缺少 url 或 key' });
    try {
      const upstream = await aiProxyService.fetchModels(url, key);
      const text = await upstream.text();
      res.status(upstream.status).type('application/json').send(text);
    } catch (error) {
      res.status(502).json({ error: '代理请求失败: ' + error.message });
    }
  });

  app.post('/api/proxy/chat', async (req, res) => {
    const { url, key, body } = req.body || {};
    if (!url || !key || !body) return res.status(400).json({ error: '缺少 url / key / body' });

    const controller = new AbortControllerImpl();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const upstream = await aiProxyService.fetchChat(url, key, body, controller.signal);
      res.status(upstream.status);
      res.set('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
      res.set('Cache-Control', 'no-store');
      if (!upstream.body) {
        res.end();
        return;
      }
      ReadableImpl.fromWeb(upstream.body).pipe(res);
    } catch (error) {
      if (controller.signal.aborted) return;
      res.status(502).json({ error: '代理请求失败: ' + error.message });
    }
  });
}

module.exports = { registerAiProxyRoutes };
