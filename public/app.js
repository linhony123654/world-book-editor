// ===== World Book Editor — 主入口（杂志风导航） =====
import { $, escHtml, escAttr, showToast, showConfirm, openModal, closeModal } from './modules/utils.js';
import { loadBookList, loadBook, importFile, exportFile, exportMarkdown, autoSave, scheduleSave } from './modules/api.js';
import { renderSidebar, initSidebar } from './modules/sidebar.js';
import { renderEditor, renderEditorEmpty, newEntry, deleteEntry, duplicateEntry, autoSizeTitle } from './modules/editor.js';
import { initChat, ensureMemoryLoaded, DEFAULT_SYSTEM_PROMPT, applyChatVisibleLimit } from './modules/chat.js';
import { initBooks, renderArchives } from './modules/books.js';
import { entries, currentUid, restoreUndo, undoStack, restoreUndoTo } from './modules/state.js';
import { chooseInitialBookId } from './modules/book-session.js';
import { readChatVisibleLimit, saveChatVisibleLimit } from './modules/chat-view.js';
import { checkAuth, bindAuth, showLoginScreen, authHeaders } from './modules/auth.js';

const SCREENS = ['library', 'editor', 'chat', 'archives', 'settings', 'me'];

// ===== 多 API 配置档案 =====
// 存储：wbe-api-profiles = [{id,name,url,key,model,prompt}]，wbe-api-active = id
// 切换/保存时把当前档案镜像到旧键(wbe-api-url/key/model/system-prompt)，chat.js 无需改动
let editingProfileId = null;

function loadProfiles() {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem('wbe-api-profiles') || '[]'); } catch {}
  if (!Array.isArray(arr)) arr = [];
  // 迁移旧的单一配置
  if (arr.length === 0) {
    const url = localStorage.getItem('wbe-api-url') || '';
    const key = localStorage.getItem('wbe-api-key') || '';
    if (url || key) {
      arr = [{
        id: 'p' + Date.now(), name: '默认配置', url, key,
        model: localStorage.getItem('wbe-model') || '',
        prompt: localStorage.getItem('wbe-system-prompt') || ''
      }];
      localStorage.setItem('wbe-api-profiles', JSON.stringify(arr));
      localStorage.setItem('wbe-api-active', arr[0].id);
    }
  }
  return arr;
}
function saveProfiles(arr) { localStorage.setItem('wbe-api-profiles', JSON.stringify(arr)); }
function activeProfileId() { return localStorage.getItem('wbe-api-active') || ''; }
function getProfile(id) { return loadProfiles().find(p => p.id === id) || null; }
function mirrorLegacy(p) {
  localStorage.setItem('wbe-api-url', (p && p.url) || '');
  localStorage.setItem('wbe-api-key', (p && p.key) || '');
  localStorage.setItem('wbe-model', (p && p.model) || '');
  localStorage.setItem('wbe-system-prompt', (p && p.prompt) || '');
}
function setActiveProfile(id) {
  const p = getProfile(id);
  if (!p) return;
  localStorage.setItem('wbe-api-active', id);
  mirrorLegacy(p);
  refreshSettings();
}

// ===== 屏幕切换 =====
function setScreen(name) {
  if (!SCREENS.includes(name)) return;
  SCREENS.forEach(s => {
    const el = $('screen-' + s);
    if (el) el.classList.toggle('active', s === name);
  });
  document.querySelectorAll('.bottom-nav .nav').forEach(b => {
    b.classList.toggle('active', b.dataset.nav === name);
  });
  // 滚动容器是 .app（不是 window）：进 chat 直接落到最新消息，其余回到顶部
  const app = document.querySelector('.app');
  if (app) app.scrollTop = name === 'chat' ? app.scrollHeight : 0;
  else window.scrollTo(0, 0);
  if (name === 'archives') renderArchives();
  if (name === 'settings') refreshSettings();
  if (name === 'me') fillProfile();
  if (name === 'editor') autoSizeTitle(); // 隐藏时渲染过标题，切回来重算高度
}

// ===== 我的页：填充账号信息（用户名 + 头像首字） =====
async function fillProfile() {
  const nameEl = $('meUsername');
  const avatarEl = $('meAvatar');
  if (!nameEl) return;
  try {
    const data = await cloudApi('/api/me', 'GET');
    if (data.username) {
      nameEl.textContent = data.username;
      if (avatarEl) avatarEl.textContent = String(data.username).slice(0, 1).toUpperCase();
    }
  } catch (e) {
    nameEl.textContent = '—';
  }
}

// ===== 选中条目回调（渲染编辑器，不强制切屏） =====
function onSelectEntry(uid) {
  const entry = entries.find(e => e.uid === uid);
  if (entry) renderEditor(entry);
}

// ===== 初始化 =====
async function init() {
  bindAuth();
  const authed = await checkAuth();
  if (!authed) {
    // 未登录/首次设置：等认证完成后启动主界面
    window.addEventListener('wbe:authenticated', () => bootApp(), { once: true });
    window.addEventListener('wbe:unauthorized', () => { showLoginScreen('login'); });
    return;
  }
  bootApp();
}

async function bootApp() {
  bindNav();
  bindEntryActions();
  bindSettings();
  bindApiModal();
  bindModalClose();
  bindUndo();
  bindCloud();
  bindMe();

  initSidebar(onSelectEntry, setScreen);
  initChat();
  initBooks({ renderSidebar, selectEntry: onSelectEntry, renderEditorEmpty }, setScreen);

  initTheme();
  initAutoSaveSwitch();
  // AI 改动卡片点击条目 → 跳编辑器
  document.addEventListener('wbe:goto-editor', () => setScreen('editor'));

  const books = await loadBookList();
  if (books.length > 0) {
    await loadBook(chooseInitialBookId(books), renderSidebar, onSelectEntry, renderEditorEmpty);
    await ensureMemoryLoaded(); // 书加载后同步本书记忆（角标/注入/清空都对得上）
  } else {
    renderEditorEmpty();
  }
  refreshSettings();
}

// ===== 导航绑定 =====
function bindNav() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => setScreen(btn.dataset.nav));
  });
  document.querySelectorAll('[data-go]').forEach(btn => {
    btn.addEventListener('click', () => setScreen(btn.dataset.go));
  });
}

// ===== 条目操作 =====
function bindEntryActions() {
  // FAB 新建 → 打开弹窗
  const fab = $('newEntryBtn');
  if (fab) fab.addEventListener('click', openEntryModal);

  const createBtn = $('createEntryBtn');
  if (createBtn) createBtn.addEventListener('click', onCreateEntry);
  const titleInput = $('newTitleInput');
  if (titleInput) titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); onCreateEntry(); }
  });

  // 保存条
  $('deleteBtn') && $('deleteBtn').addEventListener('click', deleteEntry);
  $('duplicateBtn') && $('duplicateBtn').addEventListener('click', duplicateEntry);
  $('saveBtn') && $('saveBtn').addEventListener('click', manualSave);
  $('quickSaveBtn') && $('quickSaveBtn').addEventListener('click', manualSave);
}

async function manualSave() {
  await autoSave();
  showToast('已保存', 'success');
}

// ===== 撤销（Ctrl/Cmd+Z 与编辑器屏「撤销」按钮） =====
function undoLast() {
  const label = restoreUndo();
  if (!label) { showToast('没有可撤销的操作', 'info'); return; }
  // 全量重渲染：侧栏 + 编辑器 + 状态
  renderSidebar();
  if (currentUid != null) {
    const entry = entries.find(e => e.uid === currentUid);
    if (entry) renderEditor(entry);
    else renderEditorEmpty();
  } else {
    renderEditorEmpty();
  }
  showToast('已撤销: ' + label, 'success');
  scheduleSave();
}

function bindUndo() {
  const btn = $('undoBtn');
  if (btn) btn.addEventListener('click', openUndoModal);
  // Ctrl/Cmd+Z：文本输入框内交给浏览器自身撤销，不拦截
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key.toLowerCase() !== 'z') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    undoLast();
  });
  // Ctrl/Cmd+S：任意位置手动保存（拦截浏览器「保存页面」）
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key.toLowerCase() !== 's') return;
    e.preventDefault();
    manualSave();
  });
}

// ===== 撤销历史弹窗：列出最近操作，点任一条回滚 =====
function openUndoModal() {
  const modal = $('undoModal');
  if (!modal) return;
  const listEl = $('undoList');
  if (listEl) {
    const stack = undoStack.slice();
    if (!stack.length) {
      listEl.innerHTML = '<div class="undo-empty">暂无撤销历史。编辑条目或让 AI 修改后，操作会出现在这里。</div>';
    } else {
      // 最新在顶部：栈索引 idx（0 = 最旧）↔ 显示行 i（0 = 最新）
      listEl.innerHTML = stack.map((s, i) => {
        const idx = stack.length - 1 - i;
        const ts = s.ts ? new Date(s.ts).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
        return '<button type="button" class="undo-row" data-idx="' + idx + '">' +
          '<span class="undo-no">' + (i + 1) + '</span>' +
          '<span class="undo-label">' + escHtml(s.label || '操作') + '</span>' +
          (ts ? '<small class="undo-ts">' + ts + '</small>' : '') +
          '</button>';
      }).join('');
      listEl.querySelectorAll('.undo-row').forEach(row => {
        row.addEventListener('click', () => {
          const idx = parseInt(row.dataset.idx);
          // 回滚到第 idx 条快照：pop 掉它及之后的所有快照，恢复该条内容
          restoreUndoTo(idx);
          renderSidebar();
          const cur = entries.find(e => e.uid === currentUid) || entries[0];
          if (cur) onSelectEntry(cur.uid);
          else renderEditorEmpty();
          scheduleSave();
          closeModal(modal);
          const label = undoStack[idx] ? undoStack[idx].label : '最早记录';
          showToast('已回滚到「' + label + '」', 'success');
        });
      });
    }
  }
  openModal(modal, { focus: $('undoList') });
}

function openEntryModal() {
  const input = $('newTitleInput');
  if (input) input.value = '';
  openModal($('entryModal'), { focus: input });
}
function onCreateEntry() {
  const input = $('newTitleInput');
  const title = (input && input.value.trim()) || '';
  newEntry(title);
  closeModal($('entryModal'));
  setScreen('editor');
}

// ===== 设置项绑定 =====
function bindSettings() {
  $('importBtn') && $('importBtn').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', e => {
    if (e.target.files[0]) importFile(e.target.files[0], renderSidebar, onSelectEntry, renderEditorEmpty);
    e.target.value = '';
  });
  $('exportBtn') && $('exportBtn').addEventListener('click', exportFile);
  $('exportMdBtn') && $('exportMdBtn').addEventListener('click', exportMarkdown);

  // ===== 配置秘钥：换浏览器/设备时一键复制与导入 =====
  // 安全说明：base64 只是编码，任何人都能解开。这里用 Web Crypto 做
  // PBKDF2(20万次迭代) + AES-GCM 密码加密，无密码无法解密。
  // 格式：wbe1:<salt b64>:<iv b64>:<ciphertext b64>；旧版 wbe:<json b64> 仍可导入。
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function encryptConfigKey(payloadJson, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(payloadJson));
    return 'wbe1:' + toB64(salt) + ':' + toB64(iv) + ':' + toB64(ct);
  }

  async function decryptConfigKey(keyStr, password) {
    const parts = keyStr.split(':');
    if (parts.length !== 4 || parts[0] !== 'wbe1') throw new Error('bad key');
    const key = await deriveKey(password, fromB64(parts[1]));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(parts[2]) }, key, fromB64(parts[3]));
    return dec.decode(pt);
  }

  function buildConfigKey() {
    return JSON.stringify({ p: loadProfiles(), a: activeProfileId(), v: 1 });
  }

  $('copyConfigKeyBtn') && $('copyConfigKeyBtn').addEventListener('click', async () => {
    const password = prompt('设置秘钥密码（导入时需要输入同一密码；建议 ≥6 位）');
    if (password === null) return; // 取消
    if (!password.trim()) return showToast('密码不能为空', 'error');
    const payloadJson = buildConfigKey();
    try {
      const key = await encryptConfigKey(payloadJson, password);
      try {
        await navigator.clipboard.writeText(key);
        showToast('已加密并复制，导入时输入同一密码即可', 'success');
      } catch {
        prompt('复制失败，请手动复制以下秘钥：', key);
      }
    } catch (e) {
      showToast('加密失败: ' + e.message, 'error');
    }
  });
  $('importConfigKeyBtn') && $('importConfigKeyBtn').addEventListener('click', async () => {
    const raw = ($('configKeyInput') && $('configKeyInput').value || '').trim();
    if (!raw) return showToast('请先粘贴秘钥', 'error');
    try {
      let payloadJson;
      if (raw.startsWith('wbe1:')) {
        const password = prompt('输入秘钥密码');
        if (password === null) return;
        payloadJson = await decryptConfigKey(raw, password);
      } else {
        // 旧版明文秘钥兼容
        const text = raw.startsWith('wbe:') ? raw.slice(4) : raw;
        payloadJson = decodeURIComponent(escape(atob(text.trim())));
      }
      const payload = JSON.parse(payloadJson);
      if (!payload || !Array.isArray(payload.p)) throw new Error('bad key');
      const valid = payload.p.filter(p => p && p.id && p.url);
      if (!valid.length) throw new Error('no profiles');
      localStorage.setItem('wbe-api-profiles', JSON.stringify(valid));
      if (payload.a && valid.some(p => p.id === payload.a)) {
        localStorage.setItem('wbe-api-active', payload.a);
        mirrorLegacy(valid.find(p => p.id === payload.a));
      } else {
        localStorage.setItem('wbe-api-active', valid[0].id);
        mirrorLegacy(valid[0]);
      }
      refreshSettings();
      showToast('已导入 ' + valid.length + ' 个接口配置', 'success');
    } catch (e) {
      showToast('秘钥无效或密码错误', 'error');
    }
  });

  $('reloadBtn') && $('reloadBtn').addEventListener('click', async () => {
    const books = await loadBookList();
    const cur = (await import('./modules/state.js')).currentBookId;
    const target = books.find(b => b.id === cur) || books[0];
    if (target) { await loadBook(target.id, renderSidebar, onSelectEntry, renderEditorEmpty); await ensureMemoryLoaded(); }
    else showToast('没有可加载的世界书', 'error');
  });
  $('openApiBtn') && $('openApiBtn').addEventListener('click', openApiModal);
  $('apiConfigRow') && $('apiConfigRow').addEventListener('click', e => {
    if (e.target.closest('#openApiBtn') || e.target.closest('#apiProfileSelect')) return;
    openApiModal();
  });
  // 快速切换档案
  const quick = $('apiProfileSelect');
  if (quick) quick.addEventListener('change', () => {
    setActiveProfile(quick.value);
    const p = getProfile(quick.value);
    showToast('已切换到「' + (p ? p.name : '') + '」', 'success');
  });

  const chatLimit = $('chatVisibleLimitInput');
  if (chatLimit) chatLimit.addEventListener('change', () => {
    const limit = saveChatVisibleLimit(chatLimit.value);
    chatLimit.value = String(limit);
    applyChatVisibleLimit();
    showToast(limit === 0 ? '会话已设为显示全部' : '会话显示最近 ' + limit + ' 条', 'success');
  });
}

function refreshSettings() {
  const profiles = loadProfiles();
  const active = getProfile(activeProfileId()) || profiles[0] || null;

  // API 状态
  const label = $('apiStatusLabel');
  if (label) {
    label.textContent = (active && active.url && active.model)
      ? ('已连接 · ' + active.model)
      : '未配置 · 点击设置 API / 模型';
  }
  // 快速切换下拉
  const quick = $('apiProfileSelect');
  if (quick) {
    if (profiles.length === 0) {
      quick.style.display = 'none';
    } else {
      quick.style.display = '';
      quick.innerHTML = profiles.map(p =>
        '<option value="' + escAttr(p.id) + '">' + escHtml(p.name || '未命名') + '</option>'
      ).join('');
      quick.value = (active && active.id) || profiles[0].id;
    }
  }
  // 自动保存开关状态
  const sw = $('autoSaveSwitch');
  if (sw) {
    sw.classList.toggle('off', localStorage.getItem('wbe-autosave') === 'off');
    syncSwitch(sw);
  }
  const chatLimit = $('chatVisibleLimitInput');
  if (chatLimit) chatLimit.value = String(readChatVisibleLimit());
}

// 开关的 .off 与 aria-checked 保持一致
function syncSwitch(sw) {
  if (sw) sw.setAttribute('aria-checked', sw.classList.contains('off') ? 'false' : 'true');
}

// ===== 主题 =====
function initTheme() {
  const saved = localStorage.getItem('wbe-theme') || 'light';
  applyTheme(saved);
  const sw = $('themeSwitch');
  if (sw) sw.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('wbe-theme', next);
  });
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const sw = $('themeSwitch');
  if (sw) {
    sw.classList.toggle('off', theme === 'dark');
    syncSwitch(sw);
  }
  const label = $('themeLabel');
  if (label) label.textContent = theme === 'dark' ? '夜墨模式 · 深色背景' : '暖纸张、墨色正文与酒红强调';
  const mc = document.querySelector('meta[name="theme-color"]');
  if (mc) mc.setAttribute('content', theme === 'dark' ? '#11110f' : '#f3efe7');
}

// ===== 自动保存开关 =====
function initAutoSaveSwitch() {
  const sw = $('autoSaveSwitch');
  if (!sw) return;
  sw.classList.toggle('off', localStorage.getItem('wbe-autosave') === 'off');
  syncSwitch(sw);
  sw.addEventListener('click', () => {
    const off = sw.classList.toggle('off');
    syncSwitch(sw);
    localStorage.setItem('wbe-autosave', off ? 'off' : 'on');
    showToast(off ? '已关闭自动保存' : '已开启自动保存', 'success');
  });
}

// ===== 通用弹窗关闭（焦点管理见 utils.js 的 Modal 工具） =====
function bindModalClose() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = $(btn.dataset.closeModal);
      closeModal(m);
    });
  });
  ['entryModal', 'bookModal', 'apiModal', 'memoryModal', 'templateModal', 'smartDraftModal'].forEach(id => {
    const m = $(id);
    if (m) m.addEventListener('click', e => { if (e.target === m) closeModal(m); });
  });
}

// ===== API 配置弹窗（多档案） =====
function populateModalSelect(profiles) {
  const sel = $('apiProfileSelectModal');
  if (!sel) return;
  let html = profiles.map(p =>
    '<option value="' + escAttr(p.id) + '">' + escHtml(p.name || '未命名') + '</option>'
  ).join('');
  if (editingProfileId === null) html += '<option value="" selected>＜新配置＞</option>';
  sel.innerHTML = html;
  if (editingProfileId !== null) sel.value = editingProfileId;
}

function fillModalFields(p) {
  $('apiNameInput').value = (p && p.name) || '';
  $('apiUrlInput').value = (p && p.url) || '';
  $('apiKeyInput').value = (p && p.key) || '';
  const model = (p && p.model) || '';
  $('apiModelSelect').dataset.current = model;
  $('apiModelSelect').innerHTML = '<option value="' + escAttr(model) + '">' +
    escHtml(model || '-- 先拉取模型列表 --') + '</option>';
  $('apiPromptInput').value = (p && p.prompt) || DEFAULT_SYSTEM_PROMPT;
  $('modelStatus').textContent = '';
  $('modelStatus').className = 'model-status';
}

function openApiModal() {
  const profiles = loadProfiles();
  editingProfileId = activeProfileId() || (profiles[0] && profiles[0].id) || null;
  const editing = getProfile(editingProfileId);
  if (!editing) editingProfileId = null; // 没有任何档案 → 进入新建态
  populateModalSelect(profiles);
  fillModalFields(editing);
  openModal($('apiModal'));
  if ($('apiUrlInput').value.trim() && $('apiKeyInput').value.trim()) {
    setTimeout(() => $('fetchModelsBtn').click(), 100);
  }
}

function bindApiModal() {
  // 在弹窗内切换正在编辑的档案
  $('apiProfileSelectModal') && $('apiProfileSelectModal').addEventListener('change', e => {
    const id = e.target.value;
    editingProfileId = id || null;
    fillModalFields(id ? getProfile(id) : null);
  });

  // 新建档案
  $('newProfileBtn') && $('newProfileBtn').addEventListener('click', () => {
    editingProfileId = null;
    populateModalSelect(loadProfiles());
    fillModalFields(null);
    $('apiNameInput').value = '新配置';
    $('apiNameInput').focus();
    $('apiNameInput').select();
  });

  // 删除档案
  $('deleteProfileBtn') && $('deleteProfileBtn').addEventListener('click', () => {
    if (editingProfileId === null) { showToast('当前是未保存的新配置', 'error'); return; }
    let arr = loadProfiles();
    const p = arr.find(x => x.id === editingProfileId);
    arr = arr.filter(x => x.id !== editingProfileId);
    saveProfiles(arr);
    if (activeProfileId() === editingProfileId) {
      if (arr.length) setActiveProfile(arr[0].id);
      else { localStorage.removeItem('wbe-api-active'); mirrorLegacy(null); }
    }
    showToast('已删除「' + (p ? p.name : '') + '」', 'success');
    editingProfileId = arr.length ? activeProfileId() : null;
    populateModalSelect(arr);
    fillModalFields(getProfile(editingProfileId));
    refreshSettings();
  });

  $('saveApiBtn') && $('saveApiBtn').addEventListener('click', () => {
    const data = {
      name: $('apiNameInput').value.trim() || '未命名',
      url: $('apiUrlInput').value.trim(),
      key: $('apiKeyInput').value.trim(),
      model: $('apiModelSelect').value,
      prompt: $('apiPromptInput').value.trim()
    };
    const arr = loadProfiles();
    let id = editingProfileId;
    const existing = id ? arr.find(p => p.id === id) : null;
    if (existing) {
      Object.assign(existing, data);
    } else {
      id = 'p' + Date.now();
      arr.push({ id, ...data });
    }
    saveProfiles(arr);
    setActiveProfile(id);   // 同时镜像到旧键供 chat.js 使用
    editingProfileId = id;
    closeModal($('apiModal'));
    showToast('已保存「' + data.name + '」', 'success');
    refreshSettings();
  });

  $('fetchModelsBtn') && $('fetchModelsBtn').addEventListener('click', async () => {
    const url = $('apiUrlInput').value.trim();
    const key = $('apiKeyInput').value.trim();
    const status = $('modelStatus');
    const modelSelect = $('apiModelSelect');

    if (!url || !key) {
      status.textContent = '请先填写 API 地址和 Key';
      status.className = 'model-status error';
      return;
    }
    status.textContent = '拉取中…';
    status.className = 'model-status';

    try {
      // 经本地后端代理转发，避免第三方网关缺 CORS 头被浏览器拦截
      const resp = await fetch('/api/proxy/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ url, key })
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const models = (data.data || data).map(m => m.id || m).filter(Boolean).sort();

      const currentModel = modelSelect.dataset.current || localStorage.getItem('wbe-model') || '';
      let options = '<option value="">-- 请选择模型 --</option>';
      for (const m of models) {
        options += '<option value="' + escAttr(m) + '"' + (m === currentModel ? ' selected' : '') + '>' + escHtml(m) + '</option>';
      }
      modelSelect.innerHTML = options;
      if (!currentModel && models.length > 0) modelSelect.value = models[0];

      status.textContent = '已获取 ' + models.length + ' 个模型';
      status.className = 'model-status success';
    } catch (e) {
      status.textContent = '拉取失败: ' + e.message;
      status.className = 'model-status error';
    }
  });
}

// ===== 外置存储（WebDAV / S3 兼容） =====
function setCloudStatus(msg, cls) {
  const el = $('cloudStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'cloud-status' + (cls ? ' ' + cls : '');
}
function cloudProvider() {
  return ($('cloudProviderS3') && $('cloudProviderS3').checked) ? 's3' : 'webdav';
}
function cloudConfigFromForm() {
  const cfg = { provider: cloudProvider(), remote_path: $('cloudRemotePath').value.trim() || 'world-books-backup.json' };
  if (cfg.provider === 's3') {
    cfg.s3_endpoint = $('cloudS3Endpoint').value.trim();
    cfg.s3_region = $('cloudS3Region').value.trim() || 'us-east-1';
    cfg.s3_bucket = $('cloudS3Bucket').value.trim();
    cfg.s3_access_key = $('cloudS3AccessKey').value.trim();
    cfg.s3_secret_key = $('cloudS3SecretKey').value;
  } else {
    cfg.webdav_url = $('cloudWebdavUrl').value.trim();
    cfg.webdav_user = $('cloudWebdavUser').value.trim();
    cfg.webdav_pass = $('cloudWebdavPass').value;
  }
  return cfg;
}
function cloudFillForm(cfg) {
  if (!cfg) return;
  const isS3 = cfg.provider === 's3';
  const webdavRadio = $('cloudProviderWebdav');
  const s3Radio = $('cloudProviderS3');
  if (webdavRadio) webdavRadio.checked = !isS3;
  if (s3Radio) s3Radio.checked = isS3;
  if ($('cloudFieldsWebdav')) $('cloudFieldsWebdav').hidden = isS3;
  if ($('cloudFieldsS3')) $('cloudFieldsS3').hidden = !isS3;
  if ($('cloudWebdavUrl')) $('cloudWebdavUrl').value = cfg.webdav_url || '';
  if ($('cloudWebdavUser')) $('cloudWebdavUser').value = cfg.webdav_user || '';
  if ($('cloudWebdavPass')) $('cloudWebdavPass').value = cfg.webdav_pass || '';
  if ($('cloudS3Endpoint')) $('cloudS3Endpoint').value = cfg.s3_endpoint || '';
  if ($('cloudS3Region')) $('cloudS3Region').value = cfg.s3_region || 'us-east-1';
  if ($('cloudS3Bucket')) $('cloudS3Bucket').value = cfg.s3_bucket || '';
  if ($('cloudS3AccessKey')) $('cloudS3AccessKey').value = cfg.s3_access_key || '';
  if ($('cloudS3SecretKey')) $('cloudS3SecretKey').value = cfg.s3_secret_key || '';
  if ($('cloudRemotePath')) $('cloudRemotePath').value = cfg.remote_path || 'world-books-backup.json';
}
async function cloudApi(path, method, body) {
  const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json', ...authHeaders() } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(path, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
  return data;
}

function bindCloud() {
  const loadCfg = async () => {
    try { cloudFillForm(await cloudApi('/api/cloud/config')); }
    catch (e) { setCloudStatus('配置读取失败: ' + e.message, 'err'); }
  };
  loadCfg();

  // 切换 provider 时切换字段区
  const webdavRadio = $('cloudProviderWebdav');
  const s3Radio = $('cloudProviderS3');
  if (webdavRadio && s3Radio) {
    const onToggle = () => {
      const isS3 = s3Radio.checked;
      const w = $('cloudFieldsWebdav'); if (w) w.hidden = isS3;
      const s = $('cloudFieldsS3'); if (s) s.hidden = !isS3;
    };
    webdavRadio.addEventListener('change', onToggle);
    s3Radio.addEventListener('change', onToggle);
  }

  $('cloudSaveBtn') && $('cloudSaveBtn').addEventListener('click', async () => {
    try {
      await cloudApi('/api/cloud/config', 'PUT', cloudConfigFromForm());
      setCloudStatus('配置已保存', 'ok');
      showToast('外置存储配置已保存', 'success');
    } catch (e) {
      setCloudStatus('保存失败: ' + e.message, 'err');
    }
  });

  $('cloudTestBtn') && $('cloudTestBtn').addEventListener('click', async () => {
    try {
      await cloudApi('/api/cloud/config', 'PUT', cloudConfigFromForm());
      setCloudStatus('测试中…');
      const r = await cloudApi('/api/cloud/test', 'POST');
      if (r.ok) { setCloudStatus('连接正常', 'ok'); showToast('云端连接正常', 'success'); }
      else { setCloudStatus(r.error || '连接失败', 'err'); showToast(r.error || '连接失败', 'error'); }
    } catch (e) {
      setCloudStatus('测试失败: ' + e.message, 'err');
    }
  });

  $('cloudUploadBtn') && $('cloudUploadBtn').addEventListener('click', async () => {
    try {
      await cloudApi('/api/cloud/config', 'PUT', cloudConfigFromForm());
      setCloudStatus('上传中…');
      const r = await cloudApi('/api/cloud/upload', 'POST');
      setCloudStatus('已上传 ' + r.books + ' 本世界书（' + (r.exportedAt || '').replace('T', ' ').slice(0, 19) + '）', 'ok');
      showToast('已上传 ' + r.books + ' 本世界书到云端', 'success');
    } catch (e) {
      setCloudStatus('上传失败: ' + e.message, 'err');
      showToast('上传失败: ' + e.message, 'error');
    }
  });

  $('cloudDownloadBtn') && $('cloudDownloadBtn').addEventListener('click', async () => {
    const ok = await showConfirm({
      title: '从云端拉取',
      message: '将用云端备份整体覆盖当前所有世界书与 AI 记忆。本地当前数据会先自动备份到 backups/cloud/。继续？',
      okText: '拉取并覆盖',
      danger: true
    });
    if (!ok) return;
    try {
      await cloudApi('/api/cloud/config', 'PUT', cloudConfigFromForm());
      setCloudStatus('拉取中…');
      const r = await cloudApi('/api/cloud/download', 'POST');
      // 数据已替换：重载当前书（或列表）
      const books = await loadBookList();
      const cur = (await import('./modules/state.js')).currentBookId;
      const target = books.find(b => b.id === cur) || books[0];
      if (target) {
        await loadBook(target.id, renderSidebar, onSelectEntry, renderEditorEmpty);
        await ensureMemoryLoaded();
      } else {
        renderEditorEmpty();
      }
      setCloudStatus('已恢复 ' + r.books + ' 本世界书', 'ok');
      showToast('已从云端恢复 ' + r.books + ' 本世界书', 'success');
    } catch (e) {
      setCloudStatus('拉取失败: ' + e.message, 'err');
      showToast('拉取失败: ' + e.message, 'error');
    }
  });
}

// ===== 我的页：快捷键 / 关于 弹窗 =====
function bindMe() {
  $('meShortcutBtn') && $('meShortcutBtn').addEventListener('click', () => openModal($('shortcutModal')));
  $('meAboutBtn') && $('meAboutBtn').addEventListener('click', () => openModal($('aboutModal')));
}

// ===== 启动 =====
init();
