import fs from 'node:fs';

const appPath = 'public/app.js';
const boundaryPath = 'tests/app-account-cloud-boundary.test.mjs';
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
  "import { createVersionHistoryController } from './modules/app/version-history.js';",
  "import { createVersionHistoryController } from './modules/app/version-history.js';\nimport { createAccountCloudController } from './modules/app/account-cloud.js';",
  'account cloud import'
);

replaceExact("  if (name === 'me') fillProfile();", "  if (name === 'me') accountCloud.fillProfile();", 'profile screen hook');
replaceExact('  bindCloud();\n  bindMe();', '  accountCloud.bindCloud();\n  accountCloud.bindMe();', 'boot account cloud binders');

replaceRegex(
  /\/\/ ===== 我的页：填充账号信息（用户名 \+ 头像首字） =====[\s\S]*?\n\/\/ ===== 选中条目回调（渲染编辑器，不强制切屏） =====/,
  '// ===== 选中条目回调（渲染编辑器，不强制切屏） =====',
  'legacy fillProfile block'
);

replaceExact(
  '// ===== 初始化 =====\nasync function init() {',
  `const accountCloud = createAccountCloudController({\n  $,\n  escHtml,\n  escAttr,\n  showToast,\n  showConfirm,\n  openModal,\n  closeModal,\n  authHeaders,\n  fetchImpl: (...args) => fetch(...args),\n  loadBookList,\n  loadBook,\n  getCurrentBookId: () => currentBookId,\n  renderSidebar,\n  selectEntry: onSelectEntry,\n  renderEditorEmpty,\n  ensureMemoryLoaded\n});\n\n// ===== 初始化 =====\nasync function init() {`,
  'account cloud controller initialization'
);

replaceRegex(
  /\/\/ ===== 外置存储（WebDAV \/ S3 兼容） =====[\s\S]*?\n\/\/ ===== 启动 =====/,
  '// ===== 启动 =====',
  'legacy cloud/account block'
);

for (const token of [
  'function fillProfile(',
  'function setCloudStatus(',
  'function cloudProvider(',
  'function cloudConfigFromForm(',
  'function cloudFillForm(',
  'async function cloudApi(',
  'function bindCloud(',
  'function bindMe('
]) {
  if (src.includes(token)) throw new Error(`legacy account/cloud implementation remains in app.js: ${token}`);
}
if (!src.includes('createAccountCloudController({') || !src.includes('accountCloud.bindCloud();') || !src.includes('accountCloud.fillProfile();')) {
  throw new Error('account/cloud delegation incomplete');
}

fs.writeFileSync(appPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\n\ntest('app delegates account/cloud lifecycle with current-book getter and UI callbacks', () => {\n  assert.match(app, /createAccountCloudController\\(\\{/);\n  assert.match(app, /getCurrentBookId: \\(\\) => currentBookId/);\n  assert.match(app, /accountCloud\\.bindCloud\\(\\)/);\n  assert.match(app, /accountCloud\\.bindMe\\(\\)/);\n  assert.match(app, /accountCloud\\.fillProfile\\(\\)/);\n});\n\ntest('app no longer owns cloud client, provider form, profile fetch or cloud binders', () => {\n  assert.doesNotMatch(app, /function fillProfile\\(/);\n  assert.doesNotMatch(app, /function cloudConfigFromForm\\(/);\n  assert.doesNotMatch(app, /async function cloudApi\\(/);\n  assert.doesNotMatch(app, /function bindCloud\\(/);\n  assert.doesNotMatch(app, /function bindMe\\(/);\n  assert.doesNotMatch(app, /\\/api\\/cloud\\/upload/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);
console.log('Account/cloud migration prepared.');
