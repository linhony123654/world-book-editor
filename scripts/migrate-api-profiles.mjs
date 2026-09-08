import fs from 'node:fs';

const appPath = 'public/app.js';
const boundaryPath = 'tests/api-profiles-boundary.test.mjs';
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
  "import { createAccountCloudController } from './modules/app/account-cloud.js';",
  "import { createAccountCloudController } from './modules/app/account-cloud.js';\nimport { createApiProfileRepository } from './modules/app/api-profiles.js';",
  'API profile repository import'
);

replaceRegex(
  /\/\/ ===== 多 API 配置档案 =====[\s\S]*?\/\/ ===== 屏幕切换 =====/,
  `// ===== 多 API 配置档案 =====\n// Repository owns migration/storage/legacy mirrors; wrappers keep the existing settings call surface stable.\nlet editingProfileId = null;\n\nconst profileRepo = createApiProfileRepository({\n  storage: localStorage,\n  onActiveChanged: () => refreshSettings()\n});\n\nfunction loadProfiles() { return profileRepo.load(); }\nfunction saveProfiles(arr) { return profileRepo.save(arr); }\nfunction activeProfileId() { return profileRepo.activeId(); }\nfunction getProfile(id) { return profileRepo.get(id); }\nfunction mirrorLegacy(profile) { return profileRepo.mirrorLegacy(profile); }\nfunction setActiveProfile(id) { return profileRepo.setActive(id); }\n\n// ===== 屏幕切换 =====`,
  'legacy API profile storage block'
);

for (const token of [
  "localStorage.getItem('wbe-api-profiles')",
  "localStorage.setItem('wbe-api-profiles'",
  "localStorage.getItem('wbe-api-active')",
  "localStorage.setItem('wbe-api-active'",
  "localStorage.removeItem('wbe-api-active')"
]) {
  if (src.includes(token)) throw new Error(`legacy API profile storage token remains in app.js: ${token}`);
}
if (!src.includes('createApiProfileRepository({') || !src.includes('profileRepo.setActive(id)')) {
  throw new Error('API profile repository delegation incomplete');
}

fs.writeFileSync(appPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\n\ntest('app delegates API profile persistence and legacy mirroring to repository', () => {\n  assert.match(app, /createApiProfileRepository\\(\\{/);\n  assert.match(app, /profileRepo\\.load\\(\\)/);\n  assert.match(app, /profileRepo\\.setActive\\(id\\)/);\n  assert.doesNotMatch(app, /localStorage\\.getItem\\('wbe-api-profiles'\\)/);\n  assert.doesNotMatch(app, /localStorage\\.setItem\\('wbe-api-profiles'/);\n  assert.doesNotMatch(app, /localStorage\\.getItem\\('wbe-api-active'\\)/);\n  assert.doesNotMatch(app, /localStorage\\.setItem\\('wbe-api-active'/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('API profile repository migration prepared.');
