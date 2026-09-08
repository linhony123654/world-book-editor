const { DEFAULT_REMOTE_PATH } = require('./cloud-service');

function registerCloudRoutes(app, { cloudService } = {}) {
  if (!app) throw new TypeError('Cloud routes require app');
  if (!cloudService) throw new TypeError('Cloud routes require cloudService');

  app.get('/api/cloud/config', (req, res) => {
    const cfg = cloudService.getConfig();
    res.json(cfg || { provider: 'webdav', remote_path: DEFAULT_REMOTE_PATH });
  });

  app.put('/api/cloud/config', (req, res) => {
    cloudService.configure(req.body || {});
    res.json({ ok: true });
  });

  app.post('/api/cloud/test', async (req, res) => {
    const result = await cloudService.testConnection();
    if (result.error === 'not_configured') return res.status(400).json({ error: '尚未配置外置存储' });
    res.json(result);
  });

  app.post('/api/cloud/upload', async (req, res) => {
    try {
      const result = await cloudService.upload();
      if (result.error === 'not_configured') return res.status(400).json({ error: '尚未配置外置存储' });
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: '上传失败: ' + error.message });
    }
  });

  app.get('/api/cloud/versions', (req, res) => {
    res.json({ versions: cloudService.listVersions() });
  });

  app.post('/api/cloud/download', async (req, res) => {
    try {
      const result = await cloudService.download((req.body || {}).versionPath);
      if (result.error === 'not_configured') return res.status(400).json({ error: '尚未配置外置存储' });
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: '拉取失败: ' + error.message });
    }
  });
}

module.exports = { registerCloudRoutes };
