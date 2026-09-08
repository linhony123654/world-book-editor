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
import { createModalLifecycleController } from './modules/app/modal-lifecycle.js';
import { createAppBootstrapController } from './modules/app/bootstrap.js';


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

const modalLifecycle = createModalLifecycleController({
  $,
  documentRef: document,
  closeModal
});

const bootstrap = createAppBootstrapController({
  windowRef: window,
  documentRef: document,
  bindAuth,
  checkAuth,
  showLoginScreen,
  binders: [
    () => navigation.bind(),
    () => entryActions.bind(),
    () => dataTools.bind(),
    () => preferences.bind(),
    () => apiSettings.bind(),
    () => versionHistory.bind(),
    () => modalLifecycle.bind(),
    () => undoHistory.bind(),
    () => accountCloud.bindCloud(),
    () => accountCloud.bindMe()
  ],
  initSidebar,
  initChat,
  initBooks,
  setWbeDeps,
  renderSidebar,
  selectEntry: onSelectEntry,
  renderEditorEmpty,
  setScreen,
  loadBookList,
  chooseInitialBookId,
  loadBook,
  ensureMemoryLoaded,
  refreshSettings: () => preferences.refreshSettings()
});

// ===== 启动 =====
bootstrap.init();
