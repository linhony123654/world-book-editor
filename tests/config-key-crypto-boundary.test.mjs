import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const dataTools = fs.readFileSync(new URL('../public/modules/app/data-tools.js', import.meta.url), 'utf8');

test('config key protocol stays outside app composition code', () => {
  assert.match(dataTools, /encryptConfigKey\(buildConfigKeyPayload\(profileRepo\), password\)/);
  assert.match(dataTools, /decryptConfigKey\(raw, password\)/);
  assert.match(dataTools, /decodeLegacyConfigKey\(raw\)/);
  assert.match(dataTools, /isEncryptedConfigKey\(raw\)/);
  assert.doesNotMatch(app, /crypto\.subtle/);
  assert.doesNotMatch(app, /crypto\.getRandomValues/);
  assert.doesNotMatch(app, /new TextEncoder\(\)/);
  assert.doesNotMatch(app, /decodeURIComponent\(escape\(atob\(/);
});
