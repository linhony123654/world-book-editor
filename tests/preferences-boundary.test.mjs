import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/modules/app/navigation.js', import.meta.url), 'utf8');

test('app delegates preferences lifecycle and rendering to controller', () => {
  assert.match(app, /createPreferencesController\(\{/);
  assert.match(app, /preferences\.bind\(\)/);
  assert.match(app, /preferences\.refreshSettings\(\)/);
  assert.match(navigation, /setSettingsTab\('pref'\)/);
  assert.ok(
    /preferences\.setSettingsTab\('pref'\)/.test(app) ||
    /setSettingsTab: tab => preferences\.setSettingsTab\(tab\)/.test(app),
    'settings-tab ownership must be either the guarded pre-migration call or navigation callback wiring'
  );
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
