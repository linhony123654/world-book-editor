// ===== 工具函数 =====

export function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

// 专门用于 HTML 属性里的 URL：转义引号等特殊字符防止属性注入，
// 且只放行 http/https/mailto 协议，其余协议一律返回 ''（调用方应渲染为纯文本而非链接）
export function escUrl(s) {
  const str = String(s == null ? '' : s).trim();
  if (!/^(https?:|mailto:)/i.test(str)) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
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

// ===== Toast 通知（单一 #toast 元素；可带一个操作按钮，如「撤销」） =====
// showToast(msg, type, { actionLabel, onAction, duration })
let _toastTimer = null;
export function showToast(msg, type, opts) {
  try {
    const el = document.getElementById('toast');
    if (!el) { console.log('[Toast ' + type + '] ' + msg); return; }
    const textEl = document.getElementById('toastText');
    if (textEl) textEl.textContent = msg;
    else el.textContent = msg;
    el.className = 'toast toast-' + (type || 'info');
    // 错误型提示用 alert 角色（assertive），其余用 status（polite），让读屏可感知
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    // 可选操作按钮：显示并绑定一次性点击
    const actEl = document.getElementById('toastAction');
    const actionLabel = (opts && opts.actionLabel) || '';
    if (actEl) {
      if (actionLabel) {
        actEl.textContent = actionLabel;
        actEl.hidden = false;
        actEl.onclick = () => {
          actEl.hidden = true;
          if (opts && opts.onAction) opts.onAction();
        };
      } else {
        actEl.hidden = true;
        actEl.onclick = null;
      }
    }
    requestAnimationFrame(() => el.classList.add('show'));
    if (_toastTimer) clearTimeout(_toastTimer);
    const duration = (opts && opts.duration) || 2400;
    _toastTimer = setTimeout(() => {
      el.classList.remove('show');
      if (actEl) actEl.hidden = true;
    }, duration);
  } catch (e) {
    console.log('[Toast error]', e, msg);
  }
}

// 粗略 token 估算（CL100K 近似）：CJK 约 0.8 token/字，其余约 0.3 token/字符。
// 用于上下文预算管理与成本可见性，不需要精确。
export function estimateTokens(text) {
  if (text == null) return 0;
  const s = String(text);
  if (!s) return 0;
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]/g) || []).length;
  return Math.ceil(cjk * 0.8 + (s.length - cjk) * 0.3);
}

// ===== Modal 弹窗：焦点管理（Esc 关闭 / Tab 循环 / 焦点归还 / 背景滚动锁） =====
// 弹窗只要带 .modal.open 即生效（不依赖调用方是否走 openModal）；
// openModal 额外记录触发元素，关闭时把焦点归还给触发者。
const _modalStack = [];   // [{ el, prev }] 只记录经由 openModal 打开的弹窗
let _modalReady = false;

function _focusables(el) {
  return Array.from(el.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(n => n.offsetParent !== null || n === document.activeElement);
}

function _topOpenModal() {
  const open = Array.from(document.querySelectorAll('.modal.open'));
  return open[open.length - 1] || null;
}

function _syncScrollLock() {
  const locked = document.querySelectorAll('.modal.open').length > 0;
  document.body.classList.toggle('modal-lock', locked);
}

function _onModalKeydown(e) {
  // Esc：关闭最上层弹窗
  if (e.key === 'Escape') {
    const top = _topOpenModal();
    if (top) {
      e.preventDefault();
      closeModal(top);
    }
    return;
  }
  // Tab：焦点循环（首尾环绕）
  if (e.key === 'Tab') {
    const top = _topOpenModal();
    if (!top) return;
    const focusables = _focusables(top);
    if (!focusables.length) { e.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const within = top.contains(document.activeElement);
    if (!within) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

function _ensureModalHandlers() {
  if (_modalReady) return;
  _modalReady = true;
  document.addEventListener('keydown', _onModalKeydown);
}
// 模块加载即挂载：保证任何方式打开的 .modal.open（含 chat.js 直接 classList 操作）都有 Esc/Tab 处理
// typeof document 守卫：node --test 直接 import 本模块时跳过 DOM 挂载
if (typeof document !== 'undefined') _ensureModalHandlers();

export function openModal(el, opts) {
  if (!el) return null;
  if (el.classList.contains('open')) return el;
  const prev = document.activeElement;
  el.classList.add('open');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  _modalStack.push({ el, prev });
  _syncScrollLock();
  // 聚焦弹窗内第一个可聚焦元素（或调用方指定的元素）
  const focusTarget = (opts && opts.focus) || _focusables(el)[0];
  if (focusTarget && typeof focusTarget.focus === 'function') {
    try { focusTarget.focus(); } catch (e) {}
  }
  el.dispatchEvent(new CustomEvent('modal:opened'));
  return el;
}

export function closeModal(el) {
  if (!el || !el.classList.contains('open')) return;
  // 先把焦点从弹窗内移出（部分浏览器不会在 display:none 时自动归还焦点）
  const active = document.activeElement;
  if (active && el.contains(active) && typeof active.blur === 'function') {
    try { active.blur(); } catch (e) {}
  }
  el.classList.remove('open');
  const idx = _modalStack.findIndex(s => s.el === el);
  let prev = null;
  if (idx >= 0) {
    prev = _modalStack[idx].prev;
    _modalStack.splice(idx, 1);
  }
  _syncScrollLock();
  el.dispatchEvent(new CustomEvent('modal:closed'));
  // 焦点归还：关闭的是最上层弹窗，且当前焦点已丢失（弹窗被隐藏后浏览器把焦点移到 body）
  if (prev && prev.isConnected &&
      (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) {
    try { prev.focus(); } catch (e) {}
  }
  return el;
}

// ===== 应用内确认弹窗（替代 confirm() / 二次点击删除） =====
// showConfirm({ title, message, okText, danger }) => Promise<boolean>
export function showConfirm(opts) {
  const modal = document.getElementById('confirmModal');
  if (!modal) return Promise.resolve(false);
  const titleEl = document.getElementById('confirmTitle');
  const textEl = document.getElementById('confirmText');
  const okBtn = document.getElementById('confirmOkBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if (titleEl) titleEl.textContent = (opts && opts.title) || '确认操作';
  if (textEl) textEl.textContent = (opts && opts.message) || '';
  if (okBtn) {
    okBtn.textContent = (opts && opts.okText) || '确定';
    okBtn.className = 'action' + ((opts && opts.danger) ? ' danger' : ' primary');
  }
  return new Promise(resolve => {
    let settled = false;
    const done = val => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('modal:closed', onClosed);
      closeModal(modal);
      resolve(val);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    // 点背景 / 按 Esc / 走 data-close-modal 关闭时视为取消
    const onClosed = () => done(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('modal:closed', onClosed);
    openModal(modal, { focus: cancelBtn });
  });
}
