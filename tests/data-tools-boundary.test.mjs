import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('app delegates data transfer and config-key UI orchestration to controller', () => {
  assert.match(app, /createDataToolsController\(\{/);
  assert.match(app, /dataTools\.bind\(\)/);
  assert.match(app, /copyText,/);
  assert.doesNotMatch(app, /function bindSettings/);
  assert.doesNotMatch(app, /navigator\.clipboard\.writeText/);
  assert.doesNotMatch(app, /profileRepo\.replaceImported\(payload\.p, payload\.a\)/);
  assert.equal(app.includes("await import('./modules/state.js')"), false);
});
