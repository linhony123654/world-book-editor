import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const preferences = fs.readFileSync(new URL('../public/modules/app/preferences.js', import.meta.url), 'utf8');
const dataTools = fs.readFileSync(new URL('../public/modules/app/data-tools.js', import.meta.url), 'utf8');

test('app delegates API settings UI lifecycle to controller', () => {
  assert.match(app, /createApiSettingsController\(\{/);
  assert.match(app, /apiSettings\.bind\(\)/);
  assert.doesNotMatch(app, /editingProfileId/);
  assert.doesNotMatch(app, /JB_PRESETS/);
  assert.doesNotMatch(app, /function bindJbPresets/);
  assert.doesNotMatch(app, /function openApiModal/);
  assert.doesNotMatch(app, /function bindApiModal/);
  assert.doesNotMatch(app, /function populateModalSelect/);
});

test('preferences owns API status rendering while app keeps API status formatter as an injected dependency', () => {
  assert.match(preferences, /status\.textContent = apiStatusText\(active\)/);
  assert.match(app, /apiStatusText/);
});

test('data tools owns config-key profile payload orchestration', () => {
  assert.match(dataTools, /p: profileRepo\.load\(\)/);
  assert.match(dataTools, /a: profileRepo\.activeId\(\)/);
  assert.match(dataTools, /profileRepo\.replaceImported\(/);
});
