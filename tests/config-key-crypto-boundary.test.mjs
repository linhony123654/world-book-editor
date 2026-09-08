import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('app delegates config key crypto protocol to dedicated module', () => {
  assert.match(app, /encryptConfigKey\(payloadJson, password\)/);
  assert.match(app, /decryptConfigKey\(raw, password\)/);
  assert.match(app, /decodeLegacyConfigKey\(raw\)/);
  assert.match(app, /isEncryptedConfigKey\(raw\)/);
  assert.doesNotMatch(app, /crypto\.subtle/);
  assert.doesNotMatch(app, /crypto\.getRandomValues/);
  assert.doesNotMatch(app, /new TextEncoder\(\)/);
  assert.doesNotMatch(app, /decodeURIComponent\(escape\(atob\(/);
});
