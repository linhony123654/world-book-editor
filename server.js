const express = require('express');
const path = require('path');
const { createDatabase } = require('./server/database');
const { createAuthService, createLoginRateLimiter, registerAuthRoutes } = require('./server/auth');
const { createBooksService } = require('./server/books-service');
const { registerBookRoutes, registerVersionRoutes } = require('./server/books-routes');
const { createAiDataService } = require('./server/ai-data-service');
const { registerAiDataRoutes } = require('./server/ai-data-routes');
const { createCloudTransports } = require('./server/cloud-transports');
const { createCloudService } = require('./server/cloud-service');
const { registerCloudRoutes } = require('./server/cloud-routes');
const { createSearchService } = require('./server/search-service');
const { registerSearchRoutes } = require('./server/search-routes');
const { createAiProxyService } = require('./server/ai-proxy-service');
const { registerAiProxyRoutes } = require('./server/ai-proxy-routes');

const app = express();
const PORT = process.env.PORT || 8084;

app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));

// ===== 安全响应头 =====
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; '));
  next();
});

// 只暴露 public/ 下的前端文件；数据库/源码/依赖目录一律不可访问
// 缓存策略：index.html 与 ES 模块每次重新验证（no-cache + ETag，304 无 body 几乎零成本，部署立即可见）；
// 其余资源（app.js / style.css 等带 ?v= 版本号）缓存 1 小时
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.includes(path.sep + 'modules' + path.sep)) {
      res.set('Cache-Control', 'no-cache');
    } else {
      res.set('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// ===== SQLite =====
const db = createDatabase();

// ===== 认证 =====
const authService = createAuthService({ db });
const authRequired = authService.authRequired;
const loginLimiter = createLoginRateLimiter();
const loginRateLimit = loginLimiter.middleware;
loginLimiter.startCleanup();
registerAuthRoutes(app, { db, authService, loginRateLimit });

// ===== Books / Versions =====
const booksService = createBooksService({ db, rootDir: __dirname });
registerVersionRoutes(app, { authRequired, booksService });

// ===== Search Proxy =====
const searchService = createSearchService();
registerSearchRoutes(app, { authRequired, searchService });

// 数据 API 全部需要登录
app.use(['/api/books', '/api/proxy', '/api/test-tool', '/api/ai-data', '/api/cloud'], authRequired);

// ===== AI Data =====
const aiDataService = createAiDataService({ db });
registerAiDataRoutes(app, { aiDataService });

// ===== Cloud Sync =====
const cloudTransports = createCloudTransports();
const cloudService = createCloudService({ db, rootDir: __dirname, transports: cloudTransports });
registerCloudRoutes(app, { cloudService });

// ===== Books API =====
registerBookRoutes(app, { booksService });
booksService.seedSampleIfEmpty();

// ===== AI Proxy =====
const aiProxyService = createAiProxyService();
registerAiProxyRoutes(app, { aiProxyService });

// ===== API: 测试工具 =====
app.post('/api/test-tool', (req, res) => {
  const { tool, args } = req.body;
  const bookRow = db.prepare('SELECT data FROM world_books ORDER BY updated_at DESC LIMIT 1').get();
  if (!bookRow) return res.json({ error: 'no books' });
  const book = JSON.parse(bookRow.data);
  const entries = Object.values(book.entries);

  if (tool === 'search_entries') {
    const query = (args.query || '').toLowerCase();
    let list = entries;
    if (args.filter === 'constant') list = list.filter(e => e.constant && !e.disable);
    else if (args.filter === 'keyword') list = list.filter(e => !e.constant && !e.disable);
    if (query) {
      list = list.filter(e =>
        (e.comment||'').toLowerCase().includes(query) ||
        (e.key||[]).some(k => k.toLowerCase().includes(query)) ||
        (e.content||'').toLowerCase().includes(query)
      );
    }
    return res.json({ count: list.length, results: list.slice(0, 5).map(e => ({ uid: e.uid, comment: e.comment })) });
  }
  res.json({ error: 'unknown tool' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('[WBE] Server running on port ' + PORT);
});
