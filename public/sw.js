/* World Book Editor Service Worker —— 缓存静态资源，保证离线可打开 */
const CACHE = 'wbe-v3';
const CORE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
  // 全部 ES 模块：离线首开必须可用（缺一个 import 失败整个 app 白屏）
  '/modules/utils.js',
  '/modules/state.js',
  '/modules/api.js',
  '/modules/auth.js',
  '/modules/sidebar.js',
  '/modules/editor.js',
  '/modules/books.js',
  '/modules/chat.js',
  '/modules/chat-view.js',
  '/modules/book-session.js',
  '/modules/writing-template.js',
  '/modules/smart-draft.js',
  '/modules/smart-draft-state.js',
  '/modules/worldbook-intelligence/index.js',
  '/modules/worldbook-intelligence/taxonomy.js',
  '/modules/worldbook-intelligence/intent.js',
  '/modules/worldbook-intelligence/decision-matrix.js',
  '/modules/worldbook-intelligence/trigger-safety.js',
  '/modules/worldbook-intelligence/settings-matrix.js',
  '/modules/worldbook-intelligence/templates.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 网络优先，失败回退缓存；API 请求不缓存 */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/')))
  );
});
