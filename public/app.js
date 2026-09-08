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
import { createDataToolsController } from './modules/app/data-tools.js';
import { copyText } from './modules/ai/ui/clipboard.js';
import { createUndoHistoryController } from './modules/app/undo-history.js';
import { createEntryActionsController } from './modules/app/entry-actions.js';
import { createNavigationController } from './modules/app/navigation.js';


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

const dataTools = createDataToolsController({
  $,
  importFile,
  exportFile,
  exportMarkdown,
  loadBookList,
  loadBook,
  getCurrentBookId: () => currentBookId,
  renderSidebar,
  selectEntry: onSelectEntry,
  renderEditorEmpty,
  ensureMemoryLoaded,
  profileRepo,
  refreshSettings: () => preferences.refreshSettings(),
  encryptConfigKey,
  decryptConfigKey,
  decodeLegacyConfigKey,
  isEncryptedConfigKey,
  copyText,
  navigatorRef: navigator,
  documentRef: document,
  promptFn: (...args) => prompt(...args),
  showToast
});

const navigation = createNavigationController({
  $,
  documentRef: document,
  windowRef: window,
  renderArchives,
  refreshSettings: () => preferences.refreshSettings(),
  setSettingsTab: tab => preferences.setSettingsTab(tab),
  fillProfile: () => accountCloud.fillProfile(),
  autoSizeTitle
});
const setScreen = navigation.setScreen;

const entryActions = createEntryActionsController({
  $,
  documentRef: document,
  newEntry,
  deleteEntry,
  duplicateEntry,
  autoSave,
  openModal,
  closeModal,
  setScreen,
  showToast
});

const undoHistory = createUndoHistoryController({
  $,
  documentRef: document,
  getEntries: () => entries,
  getCurrentUid: () => currentUid,
  getUndoStack: () => undoStack,
  restoreUndo,
  restoreUndoTo,
  renderSidebar,
  renderEditor,
  renderEditorEmpty,
  selectEntry: onSelectEntry,
  scheduleSave,
  openModal,
  closeModal,
  escHtml,
  showToast
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
  navigation.bind();
  entryActions.bind();
  dataTools.bind();
  preferences.bind();
  apiSettings.bind();
  versionHistory.bind();
  bindModalClose();
  undoHistory.bind();
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
