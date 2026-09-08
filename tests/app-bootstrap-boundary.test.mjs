import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/modules/app/bootstrap.js', import.meta.url), 'utf8');
const modals = fs.readFileSync(new URL('../public/modules/app/modal-lifecycle.js', import.meta.url), 'utf8');

test('app delegates startup and modal lifecycle while remaining the composition root', () => {
  assert.match(app, /createAppBootstrapController\(\{/);
  assert.match(app, /createModalLifecycleController\(\{/);
  assert.match(app, /bootstrap\.init\(\)/);
  assert.doesNotMatch(app, /async function init\(/);
  assert.doesNotMatch(app, /async function bootApp\(/);
  assert.doesNotMatch(app, /function bindModalClose\(/);
});

test('bootstrap owns auth handoff, binder order, initial book and application event orchestration', () => {
  assert.match(bootstrap, /bindAuth\(\)/);
  assert.match(bootstrap, /await checkAuth\(\)/);
  assert.match(bootstrap, /wbe:authenticated/);
  assert.match(bootstrap, /wbe:unauthorized/);
  assert.match(bootstrap, /binders\.forEach/);
  assert.match(bootstrap, /wbe:goto-editor/);
  assert.match(bootstrap, /await loadBookList\(\)/);
  assert.match(bootstrap, /chooseInitialBookId\(books\)/);
  assert.match(bootstrap, /await ensureMemoryLoaded\(\)/);
  assert.match(bootstrap, /refreshSettings\(\)/);
});

test('modal lifecycle owns close triggers and direct-backdrop dismissal', () => {
  assert.match(modals, /\[data-close-modal\]/);
  assert.match(modals, /event\.target === modal/);
  assert.match(modals, /DEFAULT_BACKDROP_MODAL_IDS/);
});
