import fs from 'node:fs';

const appPath = 'public/app.js';
const boundaryPath = 'tests/app-version-history-boundary.test.mjs';
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
  "import { checkAuth, bindAuth, showLoginScreen, authHeaders } from './modules/auth.js';",
  "import { checkAuth, bindAuth, showLoginScreen, authHeaders } from './modules/auth.js';\nimport { createVersionHistoryController } from './modules/app/version-history.js';",
  'version history import'
);

replaceExact(
  "function onSelectEntry(uid) {\n  const entry = entries.find(e => e.uid === uid);\n  if (entry) renderEditor(entry);\n}\n",
  `function onSelectEntry(uid) {\n  const entry = entries.find(e => e.uid === uid);\n  if (entry) renderEditor(entry);\n}\n\nconst versionHistory = createVersionHistoryController({\n  $,\n  escHtml,\n  apiRequest,\n  getCurrentBookId: () => currentBookId,\n  getWorldBook: () => worldBook,\n  loadBookList,\n  loadBook,\n  renderSidebar,\n  selectEntry: onSelectEntry,\n  renderEditorEmpty,\n  ensureMemoryLoaded,\n  showToast,\n  confirmFn: message => confirm(message)\n});\n`,
  'version history controller initialization'
);

replaceExact('  bindVersions();', '  versionHistory.bind();', 'boot version binder');

replaceRegex(
  /\/\/ ===== 版本 diff：GitHub 风格对比（版本 vs 当前） =====[\s\S]*?\nfunction updateJbUndoRow\(\) \{/,
  'function updateJbUndoRow() {',
  'legacy version history block'
);

for (const token of [
  'const DIFF_FIELDS',
  'function lineDiff(',
  'function computeBookDiff(',
  'function renderDiff(',
  'function bindVersions('
]) {
  if (src.includes(token)) throw new Error(`legacy version history implementation remains in app.js: ${token}`);
}
if (!src.includes('createVersionHistoryController({') || !src.includes('versionHistory.bind();')) {
  throw new Error('version history delegation incomplete');
}

fs.writeFileSync(appPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\n\ntest('app delegates version history to its controller with live state getters', () => {\n  assert.match(app, /createVersionHistoryController\\(\\{/);\n  assert.match(app, /getCurrentBookId: \\(\\) => currentBookId/);\n  assert.match(app, /getWorldBook: \\(\\) => worldBook/);\n  assert.match(app, /versionHistory\\.bind\\(\\)/);\n});\n\ntest('app no longer owns version diff algorithms or version modal binder', () => {\n  assert.doesNotMatch(app, /const DIFF_FIELDS/);\n  assert.doesNotMatch(app, /function lineDiff\\(/);\n  assert.doesNotMatch(app, /function computeBookDiff\\(/);\n  assert.doesNotMatch(app, /function renderDiff\\(/);\n  assert.doesNotMatch(app, /function bindVersions\\(/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);
console.log('Version history migration prepared.');
