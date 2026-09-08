import fs from 'node:fs';

const appPath = 'public/app.js';
const boundaryPath = 'tests/data-tools-boundary.test.mjs';
let src = fs.readFileSync(appPath, 'utf8');

function replaceExact(search, replacement, label) {
  const count = src.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  src = src.replace(search, replacement);
}

function replaceRegex(search, replacement, label) {
  const flags = search.flags.includes('g') ? search.flags : search.flags + 'g';
  const count = [...src.matchAll(new RegExp(search.source, flags))].length;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  src = src.replace(search, replacement);
}

replaceExact(
  "import { createPreferencesController } from './modules/app/preferences.js';",
  "import { createPreferencesController } from './modules/app/preferences.js';\nimport { createDataToolsController } from './modules/app/data-tools.js';\nimport { copyText } from './modules/ai/ui/clipboard.js';",
  'data tools imports'
);

replaceExact(
  `const apiSettings = createApiSettingsController({\n  $,\n  escHtml,\n  escAttr,\n  showToast,\n  openModal,\n  closeModal,\n  authHeaders,\n  fetchImpl: (...args) => fetch(...args),\n  profileRepo,\n  defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,\n  refreshSettings: () => preferences.refreshSettings()\n});`,
  `const apiSettings = createApiSettingsController({\n  $,\n  escHtml,\n  escAttr,\n  showToast,\n  openModal,\n  closeModal,\n  authHeaders,\n  fetchImpl: (...args) => fetch(...args),\n  profileRepo,\n  defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,\n  refreshSettings: () => preferences.refreshSettings()\n});\n\nconst dataTools = createDataToolsController({\n  $,\n  importFile,\n  exportFile,\n  exportMarkdown,\n  loadBookList,\n  loadBook,\n  getCurrentBookId: () => currentBookId,\n  renderSidebar,\n  selectEntry: onSelectEntry,\n  renderEditorEmpty,\n  ensureMemoryLoaded,\n  profileRepo,\n  refreshSettings: () => preferences.refreshSettings(),\n  encryptConfigKey,\n  decryptConfigKey,\n  decodeLegacyConfigKey,\n  isEncryptedConfigKey,\n  copyText,\n  navigatorRef: navigator,\n  documentRef: document,\n  promptFn: (...args) => prompt(...args),\n  showToast\n});`,
  'data tools controller initialization'
);

replaceExact(
  `  bindNav();\n  bindEntryActions();\n  bindSettings();\n  preferences.bind();`,
  `  bindNav();\n  bindEntryActions();\n  dataTools.bind();\n  preferences.bind();`,
  'boot data tools binding'
);

replaceRegex(
  /\/\/ ===== 设置项绑定 =====[\s\S]*?\/\/ ===== 通用弹窗关闭（焦点管理见 utils\.js 的 Modal 工具） =====/,
  `// ===== 通用弹窗关闭（焦点管理见 utils.js 的 Modal 工具） =====`,
  'inline settings data tools block'
);

for (const token of [
  'function bindSettings',
  "navigator.clipboard.writeText",
  "await encryptConfigKey(payloadJson, password)",
  "await decryptConfigKey(raw, password)",
  "decodeLegacyConfigKey(raw)",
  "profileRepo.replaceImported(payload.p, payload.a)",
  "await import('./modules/state.js')"
]) {
  if (src.includes(token)) throw new Error(`legacy data tools token remains in app.js: ${token}`);
}
if (!src.includes('createDataToolsController({') || !src.includes('dataTools.bind()') || !src.includes('copyText,')) {
  throw new Error('data tools controller delegation incomplete');
}

fs.writeFileSync(appPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\n\ntest('app delegates data transfer and config-key UI orchestration to controller', () => {\n  assert.match(app, /createDataToolsController\\(\\{/);\n  assert.match(app, /dataTools\\.bind\\(\\)/);\n  assert.match(app, /copyText,/);\n  assert.doesNotMatch(app, /function bindSettings/);\n  assert.doesNotMatch(app, /navigator\\.clipboard\\.writeText/);\n  assert.doesNotMatch(app, /profileRepo\\.replaceImported\\(payload\\.p, payload\\.a\\)/);\n  assert.doesNotMatch(app, /await import\\('\.\/modules\/state\\.js'\\)/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('Data tools migration prepared.');
