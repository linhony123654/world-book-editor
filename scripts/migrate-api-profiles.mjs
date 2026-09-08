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

replaceExact(
  `      const valid = payload.p.filter(p => p && p.id && p.url);\n      if (!valid.length) throw new Error('no profiles');\n      localStorage.setItem('wbe-api-profiles', JSON.stringify(valid));\n      if (payload.a && valid.some(p => p.id === payload.a)) {\n        localStorage.setItem('wbe-api-active', payload.a);\n        mirrorLegacy(valid.find(p => p.id === payload.a));\n      } else {\n        localStorage.setItem('wbe-api-active', valid[0].id);\n        mirrorLegacy(valid[0]);\n      }\n      refreshSettings();\n      showToast('已导入 ' + valid.length + ' 个接口配置', 'success');`,
  `      const imported = profileRepo.replaceImported(payload.p, payload.a);\n      if (!imported.profiles.length) throw new Error('no profiles');\n      refreshSettings();\n      showToast('已导入 ' + imported.profiles.length + ' 个接口配置', 'success');`,
  'config-key profile import persistence'
);

replaceExact(
  `    if (activeProfileId() === editingProfileId) {\n      if (arr.length) setActiveProfile(arr[0].id);\n      else { localStorage.removeItem('wbe-api-active'); mirrorLegacy(null); }\n    }`,
  `    if (activeProfileId() === editingProfileId) {\n      if (arr.length) setActiveProfile(arr[0].id);\n      else profileRepo.clearActive();\n    }`,
  'last profile active-state cleanup'
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
if (!src.includes('createApiProfileRepository({') || !src.includes('profileRepo.setActive(id)') || !src.includes('profileRepo.replaceImported(') || !src.includes('profileRepo.clearActive()')) {
  throw new Error('API profile repository delegation incomplete');
}

fs.writeFileSync(appPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\n\ntest('app delegates API profile persistence and legacy mirroring to repository', () => {\n  assert.match(app, /createApiProfileRepository\\(\\{/);\n  assert.match(app, /profileRepo\\.load\\(\\)/);\n  assert.match(app, /profileRepo\\.setActive\\(id\\)/);\n  assert.match(app, /profileRepo\\.replaceImported\\(/);\n  assert.match(app, /profileRepo\\.clearActive\\(\\)/);\n  assert.doesNotMatch(app, /localStorage\\.getItem\\('wbe-api-profiles'\\)/);\n  assert.doesNotMatch(app, /localStorage\\.setItem\\('wbe-api-profiles'/);\n  assert.doesNotMatch(app, /localStorage\\.getItem\\('wbe-api-active'\\)/);\n  assert.doesNotMatch(app, /localStorage\\.setItem\\('wbe-api-active'/);\n  assert.doesNotMatch(app, /localStorage\\.removeItem\\('wbe-api-active'\\)/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('API profile repository migration prepared.');
