import fs from 'node:fs';

const appPath = 'public/app.js';
const boundaryPath = 'tests/config-key-crypto-boundary.test.mjs';
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
  "import { createApiProfileRepository } from './modules/app/api-profiles.js';",
  "import { createApiProfileRepository } from './modules/app/api-profiles.js';\nimport { decodeLegacyConfigKey, decryptConfigKey, encryptConfigKey, isEncryptedConfigKey } from './modules/app/config-key-crypto.js';",
  'config key crypto import'
);

replaceRegex(
  /  \/\/ ===== 配置秘钥：换浏览器\/设备时一键复制与导入 =====[\s\S]*?  function buildConfigKey\(\) \{/,
  `  // ===== 配置秘钥：换浏览器/设备时一键复制与导入 =====\n  // Crypto protocol lives in modules/app/config-key-crypto.js.\n  function buildConfigKey() {`,
  'inline config key crypto implementation'
);

replaceExact(
  "      if (raw.startsWith('wbe1:')) {",
  "      if (isEncryptedConfigKey(raw)) {",
  'encrypted key format detection'
);

replaceExact(
  `        // 旧版明文秘钥兼容\n        const text = raw.startsWith('wbe:') ? raw.slice(4) : raw;\n        payloadJson = decodeURIComponent(escape(atob(text.trim())));`,
  `        // 旧版明文秘钥兼容\n        payloadJson = decodeLegacyConfigKey(raw);`,
  'legacy config key decoding'
);

for (const token of [
  'crypto.subtle',
  'crypto.getRandomValues',
  'new TextEncoder()',
  'new TextDecoder()',
  'decodeURIComponent(escape(atob('
]) {
  if (src.includes(token)) throw new Error(`legacy config crypto token remains in app.js: ${token}`);
}
if (!src.includes('encryptConfigKey(payloadJson, password)') || !src.includes('decryptConfigKey(raw, password)') || !src.includes('decodeLegacyConfigKey(raw)')) {
  throw new Error('config key crypto delegation incomplete');
}

fs.writeFileSync(appPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');\n\ntest('app delegates config key crypto protocol to dedicated module', () => {\n  assert.match(app, /encryptConfigKey\\(payloadJson, password\\)/);\n  assert.match(app, /decryptConfigKey\\(raw, password\\)/);\n  assert.match(app, /decodeLegacyConfigKey\\(raw\\)/);\n  assert.match(app, /isEncryptedConfigKey\\(raw\\)/);\n  assert.doesNotMatch(app, /crypto\\.subtle/);\n  assert.doesNotMatch(app, /crypto\\.getRandomValues/);\n  assert.doesNotMatch(app, /new TextEncoder\\(\\)/);\n  assert.doesNotMatch(app, /decodeURIComponent\\(escape\\(atob\\(/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('Config key crypto migration prepared.');
