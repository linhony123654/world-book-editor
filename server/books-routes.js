function registerVersionRoutes(app, { authRequired, booksService } = {}) {
  if (!app) throw new TypeError('Version routes require app');
  if (typeof authRequired !== 'function') throw new TypeError('Version routes require authRequired');
  if (!booksService) throw new TypeError('Version routes require booksService');

  app.get('/api/books/:id/versions', authRequired, (req, res) => {
    res.json(booksService.listVersions(req.params.id));
  });

  app.get('/api/books/:id/versions/:vid', authRequired, (req, res) => {
    const version = booksService.getVersion(req.params.id, req.params.vid);
    if (!version) return res.status(404).json({ error: '版本不存在' });
    res.json(version);
  });

  app.post('/api/books/:id/rollback', authRequired, (req, res) => {
    const vid = Number((req.body || {}).vid);
    const note = String((req.body || {}).note || '').trim();
    const result = booksService.rollbackVersion(req.params.id, vid);
    if (!result) return res.status(404).json({ error: '版本不存在' });
    res.json({ ok: true, entry_count: result.entry_count, note: note || ('回滚到版本 #' + vid) });
  });
}

function registerBookRoutes(app, { booksService } = {}) {
  if (!app) throw new TypeError('Book routes require app');
  if (!booksService) throw new TypeError('Book routes require booksService');

  app.get('/api/books', (req, res) => {
    res.json(booksService.listBooks());
  });

  app.get('/api/books/:id', (req, res) => {
    const book = booksService.getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'not found' });
    res.json(book);
  });

  app.post('/api/books', (req, res) => {
    const { name, data } = req.body;
    const result = booksService.createBook(name, data);
    if (result.error === 'invalid_data') return res.status(400).json({ error: 'invalid data' });
    res.json(result);
  });

  app.put('/api/books/:id', (req, res) => {
    const result = booksService.updateBook(req.params.id, req.body || {});
    if (result.error === 'not_found') return res.status(404).json({ error: 'not found' });
    if (result.error === 'invalid_data') return res.status(400).json({ error: 'invalid data' });
    if (result.error === 'conflict') {
      return res.status(409).json({
        error: 'conflict',
        message: '数据已在其他设备/标签页被修改',
        serverUpdatedAt: result.serverUpdatedAt
      });
    }
    res.json(result);
  });

  app.delete('/api/books/:id', (req, res) => {
    if (!booksService.deleteBook(req.params.id)) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });
}

module.exports = {
  registerBookRoutes,
  registerVersionRoutes
};
