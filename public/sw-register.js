// PWA: Service Worker 注册（仅 HTTPS/localhost 安全上下文生效）
// 独立成文件：CSP script-src 'self' 不允许内联脚本
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
