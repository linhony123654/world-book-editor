// ===== 登录 / 首次设置 / 修改密码 =====
import { $, showToast, openModal, closeModal, showConfirm } from './utils.js';

const TOKEN_KEY = 'wbe-token';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

export function authHeaders() {
  const t = getToken();
  return t ? { 'Authorization': 'Bearer ' + t } : {};
}

// 带 token 的 fetch 封装；401 时广播回登录
export async function authFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}), ...authHeaders() };
  const resp = await fetch(url, { ...opts, headers });
  if (resp.status === 401 && !url.includes('/api/login') && !url.includes('/api/auth-state') && !url.includes('/api/me')) {
    setToken('');
    window.dispatchEvent(new CustomEvent('wbe:unauthorized'));
  }
  return resp;
}

export function showLoginScreen(mode) {
  const login = $('screen-login');
  const app = document.querySelector('.app');
  if (login) login.classList.add('active');
  if (app) app.classList.add('auth-hidden');
  const isSetup = mode === 'setup';
  const setupBtn = $('loginSetupBtn');
  const loginBtn = $('loginBtn');
  const modeLabel = $('loginModeLabel');
  const title = $('loginTitle');
  const pwdInput = $('loginPassword');
  const userInput = $('loginUsername');
  if (setupBtn) setupBtn.hidden = !isSetup;
  if (loginBtn) loginBtn.hidden = isSetup;
  if (modeLabel) modeLabel.textContent = isSetup ? 'First run' : 'Sign in';
  if (title) title.textContent = isSetup ? '创建管理员账号' : '登录';
  if (pwdInput) pwdInput.placeholder = isSetup ? '设置密码（至少 6 位）' : '密码';
  if (userInput) userInput.placeholder = isSetup ? '管理员用户名' : '用户名';
  setLoginError('');
}

export function hideLoginScreen() {
  const login = $('screen-login');
  const app = document.querySelector('.app');
  if (login) login.classList.remove('active');
  if (app) app.classList.remove('auth-hidden');
  // 登录后统一回到书库屏，清掉退出前残留的屏幕状态
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const lib = $('screen-library');
  if (lib) lib.classList.add('active');
}

export function setLoginError(msg) {
  const el = $('loginError');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

export async function checkAuth() {
  try {
    const state = await (await fetch('/api/auth-state')).json();
    if (!state.initialized) {
      showLoginScreen('setup');
      return false;
    }
    const token = getToken();
    if (token) {
      const r = await fetch('/api/me', { headers: authHeaders() });
      if (r.ok) { hideLoginScreen(); return true; }
      setToken('');
    }
    showLoginScreen('login');
    return false;
  } catch {
    showLoginScreen('login');
    return false;
  }
}

export async function doLogin(username, password) {
  const resp = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || '登录失败');
  setToken(data.token);
  hideLoginScreen();
  return data;
}

export async function doSetup(username, password) {
  const resp = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || '创建失败');
  setToken(data.token);
  hideLoginScreen();
  return data;
}

export async function doLogout() {
  try { await authFetch('/api/logout', { method: 'POST' }); } catch {}
  setToken('');
  showLoginScreen('login');
}

export async function doChangePassword(oldPassword, newPassword) {
  const resp = await authFetch('/api/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword, newPassword })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || '修改失败');
  return data;
}

export function bindAuth() {
  // 登录/首次设置
  const loginBtn = $('loginBtn');
  if (loginBtn) loginBtn.addEventListener('click', async () => {
    const u = ($('loginUsername') || {}).value || '';
    const p = ($('loginPassword') || {}).value || '';
    if (!u || !p) return setLoginError('请输入用户名和密码');
    setLoginError('');
    loginBtn.disabled = true;
    try {
      await doLogin(u, p);
      showToast('欢迎回来，' + u, 'success');
      window.dispatchEvent(new CustomEvent('wbe:authenticated'));
    } catch (e) {
      setLoginError(e.message);
    } finally {
      loginBtn.disabled = false;
    }
  });
  const setupBtn = $('loginSetupBtn');
  if (setupBtn) setupBtn.addEventListener('click', async () => {
    const u = ($('loginUsername') || {}).value || '';
    const p = ($('loginPassword') || {}).value || '';
    if (!u || u.length < 2) return setLoginError('用户名至少 2 位');
    if (!p || p.length < 6) return setLoginError('密码至少 6 位');
    setLoginError('');
    setupBtn.disabled = true;
    try {
      await doSetup(u, p);
      showToast('管理员账号已创建', 'success');
      window.dispatchEvent(new CustomEvent('wbe:authenticated'));
    } catch (e) {
      setLoginError(e.message);
    } finally {
      setupBtn.disabled = false;
    }
  });
  const pwdInput = $('loginPassword');
  if (pwdInput) pwdInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const isSetup = !($('loginSetupBtn') || {}).hidden;
      (isSetup ? $('loginSetupBtn') : $('loginBtn')).click();
    }
  });

  // 修改密码（我的页入口 → 弹窗表单）
  const pwdBtn = $('mePwdBtn');
  if (pwdBtn) pwdBtn.addEventListener('click', () => {
    const oldInput = $('oldPasswordInput');
    const newInput = $('newPasswordInput');
    if (oldInput) oldInput.value = '';
    if (newInput) newInput.value = '';
    openModal($('pwdModal'), { focus: oldInput });
  });
  const pwdConfirmBtn = $('pwdConfirmBtn');
  if (pwdConfirmBtn) pwdConfirmBtn.addEventListener('click', async () => {
    const oldP = ($('oldPasswordInput') || {}).value || '';
    const newP = ($('newPasswordInput') || {}).value || '';
    if (!oldP) return showToast('请输入旧密码', 'error');
    if (!newP || newP.length < 6) return showToast('新密码至少 6 位', 'error');
    pwdConfirmBtn.disabled = true;
    try {
      const r = await doChangePassword(oldP, newP);
      closeModal($('pwdModal'));
      showToast(r.message || '密码已修改', 'success');
      // 所有会话失效，回登录
      setToken('');
      showLoginScreen('login');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      pwdConfirmBtn.disabled = false;
    }
  });
  // 退出登录（带确认弹窗）
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: '退出登录',
      message: '确定退出当前账号？世界书数据保留在服务器，不会丢失。',
      okText: '退出',
      danger: true
    });
    if (!ok) return;
    await doLogout();
    showToast('已退出登录', 'success');
  });
}
