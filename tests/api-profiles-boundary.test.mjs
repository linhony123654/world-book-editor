import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../public/modules/app/api-settings.js', import.meta.url), 'utf8');

test('app delegates API profile persistence and legacy mirroring to repository', () => {
  assert.match(app, /createApiProfileRepository\(\{/);
  assert.match(app, /profileRepo\.load\(\)/);
  assert.match(app, /profileRepo\.replaceImported\(/);
  assert.doesNotMatch(app, /localStorage\.getItem\('wbe-api-profiles'\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\('wbe-api-profiles'/);
  assert.doesNotMatch(app, /localStorage\.getItem\('wbe-api-active'\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\('wbe-api-active'/);
  assert.doesNotMatch(app, /localStorage\.removeItem\('wbe-api-active'\)/);
});

test('API settings controller owns profile activation and last-profile cleanup', () => {
  assert.match(settings, /profileRepo\.setActive\(/);
  assert.match(settings, /profileRepo\.clearActive\(\)/);
});
