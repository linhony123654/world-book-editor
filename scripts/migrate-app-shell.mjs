import fs from 'node:fs';

const appPath = 'public/app.js';
const boundaryPath = 'tests/app-shell-boundary.test.mjs';
let app = fs.readFileSync(appPath, 'utf8');

function replaceOnce(search, replacement, label) {
  const first = app.indexOf(search);
  if (first < 0) throw new Error(`Missing migration anchor: ${label}`);
  if (app.indexOf(search, first + search.length) >= 0) throw new Error(`Ambiguous migration anchor: ${label}`);
  app = app.replace(search, replacement);
}

function removeSection(startMarker, endMarker, label) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Missing migration section: ${label}`);
  if (app.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error(`Ambiguous migration section start: ${label}`);
  app = app.slice(0, start) + app.slice(end);
}

replaceOnce(
  "import { copyText } from './modules/ai/ui/clipboard.js';\n",
  "import { copyText } from './modules/ai/ui/clipboard.js';\n" +
  "import { createUndoHistoryController } from './modules/app/undo-history.js';\n" +
  "import { createEntryActionsController } from './modules/app/entry-actions.js';\n" +
  "import { createNavigationController } from './modules/app/navigation.js';\n",
  'app shell imports'
);

replaceOnce("\nconst SCREENS = ['library', 'editor', 'chat', 'archives', 'settings', 'me'];\n", '\n', 'inline screen registry');

removeSection('// ===== 屏幕切换 =====\n', '// ===== 选中条目回调（渲染编辑器，不强制切屏） =====\n', 'inline navigation');

replaceOnce(
  "  showToast\n});\n\n// ===== 初始化 =====\n",
  `  showToast\n});\n\nconst navigation = createNavigationController({\n  $,\n  documentRef: document,\n  windowRef: window,\n  renderArchives,\n  refreshSettings: () => preferences.refreshSettings(),\n  setSettingsTab: tab => preferences.setSettingsTab(tab),\n  fillProfile: () => accountCloud.fillProfile(),\n  autoSizeTitle\n});\nconst setScreen = navigation.setScreen;\n\nconst entryActions = createEntryActionsController({\n  $,\n  documentRef: document,\n  newEntry,\n  deleteEntry,\n  duplicateEntry,\n  autoSave,\n  openModal,\n  closeModal,\n  setScreen,\n  showToast\n});\n\nconst undoHistory = createUndoHistoryController({\n  $,\n  documentRef: document,\n  getEntries: () => entries,\n  getCurrentUid: () => currentUid,\n  getUndoStack: () => undoStack,\n  restoreUndo,\n  restoreUndoTo,\n  renderSidebar,\n  renderEditor,\n  renderEditorEmpty,\n  selectEntry: onSelectEntry,\n  scheduleSave,\n  openModal,\n  closeModal,\n  escHtml,\n  showToast\n});\n\n// ===== 初始化 =====\n`,
  'controller composition anchor'
);

replaceOnce(
  "  bindNav();\n  bindEntryActions();\n",
  "  navigation.bind();\n  entryActions.bind();\n",
  'navigation and entry binders'
);
replaceOnce("  bindUndo();\n", "  undoHistory.bind();\n", 'undo binder');

removeSection('// ===== 导航绑定 =====\n', '// ===== 通用弹窗关闭（焦点管理见 utils.js 的 Modal 工具） =====\n', 'inline shell behavior');

for (const forbidden of [
  'function setScreen(',
  'function bindNav(',
  'function bindEntryActions(',
  'async function manualSave(',
  'function undoLast(',
  'function bindUndo(',
  'function openUndoModal(',
  'function openEntryModal(',
  'function onCreateEntry('
]) {
  if (app.includes(forbidden)) throw new Error(`Legacy app shell implementation remains: ${forbidden}`);
}
for (const required of [
  'createNavigationController({',
  'createEntryActionsController({',
  'createUndoHistoryController({',
  'navigation.bind();',
  'entryActions.bind();',
  'undoHistory.bind();'
]) {
  if (!app.includes(required)) throw new Error(`Missing app shell delegation: ${required}`);
}

fs.writeFileSync(appPath, app);

fs.writeFileSync(boundaryPath, `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\nconst undo = fs.readFileSync(new URL('../public/modules/app/undo-history.js', import.meta.url), 'utf8');\nconst entries = fs.readFileSync(new URL('../public/modules/app/entry-actions.js', import.meta.url), 'utf8');\nconst navigation = fs.readFileSync(new URL('../public/modules/app/navigation.js', import.meta.url), 'utf8');\n\ntest('app composes shell controllers instead of owning their DOM behavior', () => {\n  assert.match(app, /createNavigationController\\(\\{/);\n  assert.match(app, /createEntryActionsController\\(\\{/);\n  assert.match(app, /createUndoHistoryController\\(\\{/);\n  assert.match(app, /navigation\\.bind\\(\\)/);\n  assert.match(app, /entryActions\\.bind\\(\\)/);\n  assert.match(app, /undoHistory\\.bind\\(\\)/);\n  assert.doesNotMatch(app, /function setScreen\\(/);\n  assert.doesNotMatch(app, /function bindNav\\(/);\n  assert.doesNotMatch(app, /function bindEntryActions\\(/);\n  assert.doesNotMatch(app, /function bindUndo\\(/);\n  assert.doesNotMatch(app, /function openUndoModal\\(/);\n  assert.doesNotMatch(app, /async function manualSave\\(/);\n});\n\ntest('navigation owns screen registry, nav routing and screen lifecycle hooks', () => {\n  assert.match(navigation, /APP_SCREENS/);\n  assert.match(navigation, /\\[data-nav\\]/);\n  assert.match(navigation, /\\[data-go\\]/);\n  assert.match(navigation, /renderArchives\\(\\)/);\n  assert.match(navigation, /setSettingsTab\\('pref'\\)/);\n});\n\ntest('entry actions owns create and save shortcuts while undo owns rollback shortcut/history', () => {\n  assert.match(entries, /String\\(event\\.key \\|\\| ''\\)\\.toLowerCase\\(\\) === 's'/);\n  assert.match(entries, /newEntry\\(title\\)/);\n  assert.match(entries, /await autoSave\\(\\)/);\n  assert.match(undo, /String\\(event\\.key \\|\\| ''\\)\\.toLowerCase\\(\\) === 'z'/);\n  assert.match(undo, /restoreUndoTo\\(idx\\)/);\n  assert.match(undo, /getUndoStack\\(\\)/);\n});\n`);

console.log('App shell migration prepared.');
