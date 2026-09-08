import fs from 'node:fs';

const appPath = 'public/app.js';
const boundaryPath = 'tests/app-bootstrap-boundary.test.mjs';
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
  "import { createNavigationController } from './modules/app/navigation.js';\n",
  "import { createNavigationController } from './modules/app/navigation.js';\n" +
  "import { createModalLifecycleController } from './modules/app/modal-lifecycle.js';\n" +
  "import { createAppBootstrapController } from './modules/app/bootstrap.js';\n",
  'bootstrap imports'
);

replaceOnce(
  "  showToast\n});\n\n// ===== 初始化 =====\n",
  `  showToast\n});\n\nconst modalLifecycle = createModalLifecycleController({\n  $,\n  documentRef: document,\n  closeModal\n});\n\nconst bootstrap = createAppBootstrapController({\n  windowRef: window,\n  documentRef: document,\n  bindAuth,\n  checkAuth,\n  showLoginScreen,\n  binders: [\n    () => navigation.bind(),\n    () => entryActions.bind(),\n    () => dataTools.bind(),\n    () => preferences.bind(),\n    () => apiSettings.bind(),\n    () => versionHistory.bind(),\n    () => modalLifecycle.bind(),\n    () => undoHistory.bind(),\n    () => accountCloud.bindCloud(),\n    () => accountCloud.bindMe()\n  ],\n  initSidebar,\n  initChat,\n  initBooks,\n  setWbeDeps,\n  renderSidebar,\n  selectEntry: onSelectEntry,\n  renderEditorEmpty,\n  setScreen,\n  loadBookList,\n  chooseInitialBookId,\n  loadBook,\n  ensureMemoryLoaded,\n  refreshSettings: () => preferences.refreshSettings()\n});\n\n// ===== 启动 =====\n`,
  'bootstrap composition anchor'
);

removeSection('// ===== 初始化 =====\n', '// ===== 启动 =====\n', 'inline application bootstrap');
replaceOnce('init();', 'bootstrap.init();', 'startup invocation');

for (const forbidden of [
  'async function init(',
  'async function bootApp(',
  'function bindModalClose('
]) {
  if (app.includes(forbidden)) throw new Error(`Legacy bootstrap implementation remains: ${forbidden}`);
}
for (const required of [
  'createModalLifecycleController({',
  'createAppBootstrapController({',
  'bootstrap.init();',
  '() => modalLifecycle.bind()',
  'refreshSettings: () => preferences.refreshSettings()'
]) {
  if (!app.includes(required)) throw new Error(`Missing bootstrap delegation: ${required}`);
}

fs.writeFileSync(appPath, app);
fs.writeFileSync(boundaryPath, `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\nconst bootstrap = fs.readFileSync(new URL('../public/modules/app/bootstrap.js', import.meta.url), 'utf8');\nconst modals = fs.readFileSync(new URL('../public/modules/app/modal-lifecycle.js', import.meta.url), 'utf8');\n\ntest('app delegates startup and modal lifecycle while remaining the composition root', () => {\n  assert.match(app, /createAppBootstrapController\\(\\{/);\n  assert.match(app, /createModalLifecycleController\\(\\{/);\n  assert.match(app, /bootstrap\\.init\\(\\)/);\n  assert.doesNotMatch(app, /async function init\\(/);\n  assert.doesNotMatch(app, /async function bootApp\\(/);\n  assert.doesNotMatch(app, /function bindModalClose\\(/);\n});\n\ntest('bootstrap owns auth handoff, binder order, initial book and application event orchestration', () => {\n  assert.match(bootstrap, /bindAuth\\(\\)/);\n  assert.match(bootstrap, /await checkAuth\\(\\)/);\n  assert.match(bootstrap, /wbe:authenticated/);\n  assert.match(bootstrap, /wbe:unauthorized/);\n  assert.match(bootstrap, /binders\\.forEach/);\n  assert.match(bootstrap, /wbe:goto-editor/);\n  assert.match(bootstrap, /await loadBookList\\(\\)/);\n  assert.match(bootstrap, /chooseInitialBookId\\(books\\)/);\n  assert.match(bootstrap, /await ensureMemoryLoaded\\(\\)/);\n  assert.match(bootstrap, /refreshSettings\\(\\)/);\n});\n\ntest('modal lifecycle owns close triggers and direct-backdrop dismissal', () => {\n  assert.match(modals, /\\[data-close-modal\\]/);\n  assert.match(modals, /event\\.target === modal/);\n  assert.match(modals, /DEFAULT_BACKDROP_MODAL_IDS/);\n});\n`);

console.log('App bootstrap migration prepared.');
