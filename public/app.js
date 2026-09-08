// ===== World Book Editor — 主入口（杂志风导航） =====
import { $, escHtml, escAttr, showToast, showConfirm, openModal, closeModal } from './modules/utils.js';
import { loadBookList, loadBook, importFile, exportFile, exportMarkdown, autoSave, scheduleSave, setWbeDeps, apiRequest } from './modules/api.js';
import { renderSidebar, initSidebar } from './modules/sidebar.js';
import { renderEditor, renderEditorEmpty, newEntry, deleteEntry, duplicateEntry, autoSizeTitle } from './modules/editor.js';
import { initChat, ensureMemoryLoaded, DEFAULT_SYSTEM_PROMPT, applyChatVisibleLimit, getChatUsage } from './modules/chat.js';
import { initBooks, renderArchives } from './modules/books.js';
import { entries, currentUid, restoreUndo, undoStack, restoreUndoTo, currentBookId, worldBook } from './modules/state.js';
import { chooseInitialBookId } from './modules/book-session.js';
import { readChatVisibleLimit, saveChatVisibleLimit } from './modules/chat-view.js';
import { checkAuth, bindAuth, showLoginScreen, authHeaders } from './modules/auth.js';
import { createVersionHistoryController } from './modules/app/version-history.js';
import { createAccountCloudController } from './modules/app/account-cloud.js';
import { createApiProfileRepository } from './modules/app/api-profiles.js';
import { decodeLegacyConfigKey, decryptConfigKey, encryptConfigKey, isEncryptedConfigKey } from './modules/app/config-key-crypto.js';
import { apiStatusText, createApiSettingsController } from './modules/app/api-settings.js';
import { createPreferencesController } from './modules/app/preferences.js';

const SCREENS = ['library', 'editor', 'chat', 'archives', 'settings', 'me'];

// ===== 多 API 配置档案 =====
let preferences = null;
const profileRepo = createApiProfileRepository({
  storage: localStorage,
  onActiveChanged: () => preferences?.refreshSettings()
});

preferences = createPreferencesController({
  $,
  documentRef: document,
  storage: localStorage,
  profileRepo,
  escHtml,
  escAttr,
  apiStatusText,
  readChatVisibleLimit,
  saveChatVisibleLimit,
  applyChatVisibleLimit,
  getChatUsage: async () => getChatUsage(),
  showToast
});

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
  if (name === 'settings') { preferences.refreshSettings(); preferences.setSettingsTab('pref'); }
  if (name === 'me') accountCloud.fillProfile();
  if (name === 'editor') autoSizeTitle(); // 隐藏时渲染过标题，切回来重算高度
}

// ===== 选中条目回调（渲染编辑器，不强制切屏） =====
function onSelectEntry(uid) {
  const entry = entries.find(e => e.uid === uid);
  if (entry) renderEditor(entry);
}

const versionHistory = createVersionHistoryController({
  $,
  escHtml,
  apiRequest,
  getCurrentBookId: () => currentBookId,
  getWorldBook: () => worldBook,
  loadBookList,
  loadBook,
  renderSidebar,
  selectEntry: onSelectEntry,
  renderEditorEmpty,
  ensureMemoryLoaded,
  showToast,
  confirmFn: message => confirm(message)
});

const accountCloud = createAccountCloudController({
  $,
  escHtml,
  escAttr,
  showToast,
  showConfirm,
  openModal,
  closeModal,
  authHeaders,
  fetchImpl: (...args) => fetch(...args),
  loadBookList,
  loadBook,
  getCurrentBookId: () => currentBookId,
  renderSidebar,
  selectEntry: onSelectEntry,
  renderEditorEmpty,
  ensureMemoryLoaded
});

const apiSettings = createApiSettingsController({
  $,
  escHtml,
  escAttr,
  showToast,
  openModal,
  closeModal,
  authHeaders,
  fetchImpl: (...args) => fetch(...args),
  profileRepo,
  defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  refreshSettings: () => preferences.refreshSettings()
});

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
  preferences.bind();
  apiSettings.bind();
  versionHistory.bind();
  bindModalClose();
  bindUndo();
  accountCloud.bindCloud();
  accountCloud.bindMe();

  initSidebar(onSelectEntry, setScreen);
  initChat();
  initBooks({ renderSidebar, selectEntry: onSelectEntry, renderEditorEmpty }, setScreen);
  setWbeDeps({ renderSidebar, selectEntry: onSelectEntry, renderEditorEmpty });

  // AI 改动卡片点击条目 → 跳编辑器
  document.addEventListener('wbe:goto-editor', () => setScreen('editor'));

  const books = await loadBookList();
  if (books.length > 0) {
    await loadBook(chooseInitialBookId(books), renderSidebar, onSelectEntry, renderEditorEmpty);
    await ensureMemoryLoaded(); // 书加载后同步本书记忆（角标/注入/清空都对得上）
  } else {
    renderEditorEmpty();
  }
  preferences.refreshSettings();
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
  // Crypto protocol lives in modules/app/config-key-crypto.js.
  function buildConfigKey() {
    return JSON.stringify({ p: profileRepo.load(), a: profileRepo.activeId(), v: 1 });
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
      if (isEncryptedConfigKey(raw)) {
        const password = prompt('输入秘钥密码');
        if (password === null) return;
        payloadJson = await decryptConfigKey(raw, password);
      } else {
        // 旧版明文秘钥兼容
        payloadJson = decodeLegacyConfigKey(raw);
      }
      const payload = JSON.parse(payloadJson);
      if (!payload || !Array.isArray(payload.p)) throw new Error('bad key');
      const imported = profileRepo.replaceImported(payload.p, payload.a);
      if (!imported.profiles.length) throw new Error('no profiles');
      preferences.refreshSettings();
      showToast('已导入 ' + imported.profiles.length + ' 个接口配置', 'success');
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

}

// ===== 通用弹窗关闭（焦点管理见 utils.js 的 Modal 工具） =====
function bindModalClose() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = $(btn.dataset.closeModal);
      closeModal(m);
    });
  });
  ['entryModal', 'bookModal', 'apiModal', 'memoryModal', 'templateModal', 'smartDraftModal', 'versionsModal', 'diffModal'].forEach(id => {
    const m = $(id);
    if (m) m.addEventListener('click', e => { if (e.target === m) closeModal(m); });
  });
}

// ===== 启动 =====
init();
