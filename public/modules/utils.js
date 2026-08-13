// ===== 工具函数 =====

export function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function uidKey(uid) {
  return String(uid);
}

export function $(id) {
  return document.getElementById(id);
}

// ===== 酒馆格式校验 =====
export function validateWorldBook(data) {
  if (!data || typeof data !== 'object') return '不是有效的 JSON 对象';
  if (!data.entries || typeof data.entries !== 'object') return '缺少 entries 字段';
  const keys = Object.keys(data.entries);
  // 空世界书是合法的（新建的空白书）；仅当有条目时校验其结构
  if (keys.length > 0) {
    const first = data.entries[keys[0]];
    if (!('uid' in first) || !('key' in first) || !('content' in first)) {
      return '条目缺少 uid/key/content';
    }
  }
  return null;
}

// ===== Toast 通知（单一 #toast 元素） =====
let _toastTimer = null;
export function showToast(msg, type) {
  try {
    const el = document.getElementById('toast');
    if (!el) { console.log('[Toast ' + type + '] ' + msg); return; }
    el.textContent = msg;
    el.className = 'toast toast-' + (type || 'info');
    requestAnimationFrame(() => el.classList.add('show'));
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  } catch (e) {
    console.log('[Toast error]', e, msg);
  }
}
