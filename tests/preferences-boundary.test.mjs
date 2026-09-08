import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('app delegates preferences lifecycle and rendering to controller', () => {
  assert.match(app, /createPreferencesController\(\{/);
  assert.match(app, /preferences\.bind\(\)/);
  assert.match(app, /preferences\.refreshSettings\(\)/);
  assert.match(app, /preferences\.setSettingsTab\('pref'\)/);
  assert.doesNotMatch(app, /function setSettab/);
  assert.doesNotMatch(app, /function bindSettabs/);
  assert.doesNotMatch(app, /async function refreshSettings/);
  assert.doesNotMatch(app, /function initTheme/);
  assert.doesNotMatch(app, /function initAutoSaveSwitch/);
});

test('profile and API settings refresh through preferences controller rather than app callback', () => {
  assert.match(app, /onActiveChanged: \(\) => preferences\?\.refreshSettings\(\)/);
  assert.match(app, /refreshSettings: \(\) => preferences\.refreshSettings\(\)/);
});
