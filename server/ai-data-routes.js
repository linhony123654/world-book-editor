function registerAiDataRoutes(app, { aiDataService } = {}) {
  if (!app) throw new TypeError('AI data routes require app');
  if (!aiDataService) throw new TypeError('AI data routes require aiDataService');

  app.get('/api/ai-data/:bookId', (req, res) => {
    res.json(aiDataService.get(req.params.bookId));
  });

  app.put('/api/ai-data/:bookId', (req, res) => {
    const result = aiDataService.update(req.params.bookId, req.body || {});
    if (result.error === 'invalid_book_id') return res.status(400).json({ error: 'invalid bookId' });
    if (result.error === 'no_fields') return res.status(400).json({ error: 'no fields' });
    res.json({ ok: true });
  });
}

module.exports = { registerAiDataRoutes };
