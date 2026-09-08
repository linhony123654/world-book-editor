import fs from 'node:fs';

const appPath = 'public/app.js';
const boundaryPath = 'tests/preferences-boundary.test.mjs';
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
  "import { apiStatusText, createApiSettingsController } from './modules/app/api-settings.js';",
  "import { apiStatusText, createApiSettingsController } from './modules/app/api-settings.js';\nimport { createPreferencesController } from './modules/app/preferences.js';",
  'preferences import'
);

replaceExact(
  "import { initChat, ensureMemoryLoaded, DEFAULT_SYSTEM_PROMPT, applyChatVisibleLimit } from './modules/chat.js';",
  "import { initChat, ensureMemoryLoaded, DEFAULT_SYSTEM_PROMPT, applyChatVisibleLimit, getChatUsage } from './modules/chat.js';",
  'chat usage import'
);

replaceExact(
  `// ===== 多 API 配置档案 =====\nconst profileRepo = createApiProfileRepository({\n  storage: localStorage,\n  onActiveChanged: () => refreshSettings()\n});`,
  `// ===== 多 API 配置档案 =====\nlet preferences = null;\nconst profileRepo = createApiProfileRepository({\n  storage: localStorage,\n  onActiveChanged: () => preferences?.refreshSettings()\n});\n\npreferences = createPreferencesController({\n  $,\n  documentRef: document,\n  storage: localStorage,\n  profileRepo,\n  escHtml,\n  escAttr,\n  apiStatusText,\n  readChatVisibleLimit,\n  saveChatVisibleLimit,\n  applyChatVisibleLimit,\n  getChatUsage: async () => getChatUsage(),\n  showToast\n});`,
  'profile repository and preferences initialization'
);

replaceExact(
  `  if (name === 'settings') { refreshSettings(); setSettab('pref'); }`,
  `  if (name === 'settings') { preferences.refreshSettings(); preferences.setSettingsTab('pref'); }`,
  'settings screen refresh'
);

replaceExact(
  `  defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,\n  refreshSettings\n});`,
  `  defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,\n  refreshSettings: () => preferences.refreshSettings()\n});`,
  'API settings refresh dependency'
);

replaceExact(
  `  bindSettings();\n  bindSettabs();\n  apiSettings.bind();`,
  `  bindSettings();\n  preferences.bind();\n  apiSettings.bind();`,
  'boot preferences bindings'
);

replaceExact(
  `  initTheme();\n  initAutoSaveSwitch();`,
  ``,
  'legacy theme and autosave boot calls'
);

replaceExact(
  `  refreshSettings();\n}`,
  `  preferences.refreshSettings();\n}`,
  'boot final settings refresh'
);

replaceRegex(
  /\/\/ ===== 设置页顶部标签（偏好 \/ AI 助手 \/ 数据与同步） =====[\s\S]*?\/\/ ===== 设置项绑定 =====/,
  `// ===== 设置项绑定 =====`,
  'settings tab functions'
);

replaceExact(
  `  const chatLimit = $('chatVisibleLimitInput');\n  if (chatLimit) chatLimit.addEventListener('change', () => {\n    const limit = saveChatVisibleLimit(chatLimit.value);\n    chatLimit.value = String(limit);\n    applyChatVisibleLimit();\n    showToast(limit === 0 ? '会话已设为显示全部' : '会话显示最近 ' + limit + ' 条', 'success');\n  });`,
  ``,
  'chat visible limit listener'
);

replaceRegex(
  /\nasync function refreshSettings\(\) \{[\s\S]*?\/\/ ===== 通用弹窗关闭（焦点管理见 utils\.js 的 Modal 工具） =====/,
  `\n// ===== 通用弹窗关闭（焦点管理见 utils.js 的 Modal 工具） =====`,
  'refresh theme autosave functions'
);

replaceExact(
  `      refreshSettings();\n      showToast('已导入 ' + imported.profiles.length + ' 个接口配置', 'success');`,
  `      preferences.refreshSettings();\n      showToast('已导入 ' + imported.profiles.length + ' 个接口配置', 'success');`,
  'config key import refresh'
);

for (const token of [
  'function setSettab',
  'function bindSettabs',
  'async function refreshSettings',
  'function syncSwitch',
  'function initTheme',
  'function applyTheme',
  'function initAutoSaveSwitch',
  "localStorage.getItem('wbe-theme')",
  "localStorage.getItem('wbe-autosave')"
]) {
  if (src.includes(token)) throw new Error(`legacy preferences token remains in app.js: ${token}`);
}
if (!src.includes('createPreferencesController({') || !src.includes('preferences.bind()') || !src.includes('preferences.refreshSettings()')) {
  throw new Error('preferences controller delegation incomplete');
}

fs.writeFileSync(appPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\n\ntest('app delegates preferences lifecycle and rendering to controller', () => {\n  assert.match(app, /createPreferencesController\\(\\{/);\n  assert.match(app, /preferences\\.bind\\(\\)/);\n  assert.match(app, /preferences\\.refreshSettings\\(\\)/);\n  assert.match(app, /preferences\\.setSettingsTab\\('pref'\\)/);\n  assert.doesNotMatch(app, /function setSettab/);\n  assert.doesNotMatch(app, /function bindSettabs/);\n  assert.doesNotMatch(app, /async function refreshSettings/);\n  assert.doesNotMatch(app, /function initTheme/);\n  assert.doesNotMatch(app, /function initAutoSaveSwitch/);\n});\n\ntest('profile and API settings refresh through preferences controller rather than app callback', () => {\n  assert.match(app, /onActiveChanged: \\(\\) => preferences\\?\\.refreshSettings\\(\\)/);\n  assert.match(app, /refreshSettings: \\(\\) => preferences\\.refreshSettings\\(\\)/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('Preferences migration prepared.');
