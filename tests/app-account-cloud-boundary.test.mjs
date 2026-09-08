import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('app delegates account/cloud lifecycle with current-book getter and UI callbacks', () => {
  assert.match(app, /createAccountCloudController\(\{/);
  assert.match(app, /getCurrentBookId: \(\) => currentBookId/);
  assert.match(app, /accountCloud\.bindCloud\(\)/);
  assert.match(app, /accountCloud\.bindMe\(\)/);
  assert.match(app, /accountCloud\.fillProfile\(\)/);
});

test('app no longer owns cloud client, provider form, profile fetch or cloud binders', () => {
  assert.doesNotMatch(app, /function fillProfile\(/);
  assert.doesNotMatch(app, /function cloudConfigFromForm\(/);
  assert.doesNotMatch(app, /async function cloudApi\(/);
  assert.doesNotMatch(app, /function bindCloud\(/);
  assert.doesNotMatch(app, /function bindMe\(/);
  assert.doesNotMatch(app, /\/api\/cloud\/upload/);
});
