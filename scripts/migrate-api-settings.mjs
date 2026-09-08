import fs from 'node:fs';

const appPath = 'public/app.js';
const boundaryPath = 'tests/api-settings-boundary.test.mjs';
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
  "import { decodeLegacyConfigKey, decryptConfigKey, encryptConfigKey, isEncryptedConfigKey } from './modules/app/config-key-crypto.js';",
  "import { decodeLegacyConfigKey, decryptConfigKey, encryptConfigKey, isEncryptedConfigKey } from './modules/app/config-key-crypto.js';\nimport { apiStatusText, createApiSettingsController } from './modules/app/api-settings.js';",
  'API settings controller import'
);

replaceRegex(
  /\/\/ ===== 多 API 配置档案 =====[\s\S]*?\/\/ ===== 屏幕切换 =====/,
  `// ===== 多 API 配置档案 =====\nconst profileRepo = createApiProfileRepository({\n  storage: localStorage,\n  onActiveChanged: () => refreshSettings()\n});\n\n// ===== 屏幕切换 =====`,
  'API profile compatibility wrappers'
);

replaceExact(
  `const accountCloud = createAccountCloudController({\n  $,\n  escHtml,\n  escAttr,\n  showToast,\n  showConfirm,\n  openModal,\n  closeModal,\n  authHeaders,\n  fetchImpl: (...args) => fetch(...args),\n  loadBookList,\n  loadBook,\n  getCurrentBookId: () => currentBookId,\n  renderSidebar,\n  selectEntry: onSelectEntry,\n  renderEditorEmpty,\n  ensureMemoryLoaded\n});`,
  `const accountCloud = createAccountCloudController({\n  $,\n  escHtml,\n  escAttr,\n  showToast,\n  showConfirm,\n  openModal,\n  closeModal,\n  authHeaders,\n  fetchImpl: (...args) => fetch(...args),\n  loadBookList,\n  loadBook,\n  getCurrentBookId: () => currentBookId,\n  renderSidebar,\n  selectEntry: onSelectEntry,\n  renderEditorEmpty,\n  ensureMemoryLoaded\n});\n\nconst apiSettings = createApiSettingsController({\n  $,\n  escHtml,\n  escAttr,\n  showToast,\n  openModal,\n  closeModal,\n  authHeaders,\n  fetchImpl: (...args) => fetch(...args),\n  profileRepo,\n  defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,\n  refreshSettings\n});`,
  'API settings controller initialization'
);

replaceExact(
  `  bindSettings();\n  bindSettabs();\n  bindJbPresets();\n  versionHistory.bind();\n  bindApiModal();\n  bindModalClose();`,
  `  bindSettings();\n  bindSettabs();\n  apiSettings.bind();\n  versionHistory.bind();\n  bindModalClose();`,
  'boot API settings bindings'
);

replaceExact(
  `    return JSON.stringify({ p: loadProfiles(), a: activeProfileId(), v: 1 });`,
  `    return JSON.stringify({ p: profileRepo.load(), a: profileRepo.activeId(), v: 1 });`,
  'config key payload profile access'
);

replaceRegex(
  /\n  \$\('openApiBtn'\)[\s\S]*?\n  const chatLimit = \$\('chatVisibleLimitInput'\);/,
  `\n  const chatLimit = $('chatVisibleLimitInput');`,
  'settings API entry-point listeners'
);

replaceRegex(
  /\/\/ ===== 破限预设：注入创作自由度声明到系统提示词末尾 =====[\s\S]*?\nasync function refreshSettings\(\) \{/,
  `async function refreshSettings() {`,
  'inline jailbreak preset controller'
);

replaceExact(
  `  const profiles = loadProfiles();\n  const active = getProfile(activeProfileId()) || profiles[0] || null;`,
  `  const profiles = profileRepo.load();\n  const active = profileRepo.get(profileRepo.activeId()) || profiles[0] || null;`,
  'refresh settings profile access'
);

replaceExact(
  `  if (label) {\n    label.textContent = (active && active.url && active.model)\n      ? ('已连接 · ' + active.model)\n      : '未配置 · 点击设置 API / 模型';\n  }`,
  `  if (label) label.textContent = apiStatusText(active);`,
  'API status label'
);

replaceRegex(
  /\/\/ ===== API 配置弹窗（多档案） =====[\s\S]*?\n\/\/ ===== 启动 =====/,
  `// ===== 启动 =====`,
  'inline API modal controller'
);

for (const token of [
  'editingProfileId',
  'JB_PRESETS',
  'function bindJbPresets',
  'function updateJbUndoRow',
  'function populateModalSelect',
  'function fillModalFields',
  'function openApiModal',
  'function bindApiModal',
  'function loadProfiles',
  'function saveProfiles',
  'function activeProfileId',
  'function getProfile',
  'function mirrorLegacy',
  'function setActiveProfile'
]) {
  if (src.includes(token)) throw new Error(`legacy API settings token remains in app.js: ${token}`);
}
if (!src.includes('createApiSettingsController({') || !src.includes('apiSettings.bind()') || !src.includes('apiStatusText(active)')) {
  throw new Error('API settings controller delegation incomplete');
}

fs.writeFileSync(appPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\n\ntest('app delegates API settings UI lifecycle to controller', () => {\n  assert.match(app, /createApiSettingsController\\(\\{/);\n  assert.match(app, /apiSettings\\.bind\\(\\)/);\n  assert.match(app, /apiStatusText\\(active\\)/);\n  assert.doesNotMatch(app, /editingProfileId/);\n  assert.doesNotMatch(app, /JB_PRESETS/);\n  assert.doesNotMatch(app, /function bindJbPresets/);\n  assert.doesNotMatch(app, /function openApiModal/);\n  assert.doesNotMatch(app, /function bindApiModal/);\n  assert.doesNotMatch(app, /function populateModalSelect/);\n});\n\ntest('app keeps config-key orchestration but reads profile payload directly from repository', () => {\n  assert.match(app, /p: profileRepo\\.load\\(\\)/);\n  assert.match(app, /a: profileRepo\\.activeId\\(\\)/);\n  assert.match(app, /profileRepo\\.replaceImported\\(/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('API settings controller migration prepared.');
