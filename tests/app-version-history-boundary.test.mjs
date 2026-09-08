import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('app delegates version history to its controller with live state getters', () => {
  assert.match(app, /createVersionHistoryController\(\{/);
  assert.match(app, /getCurrentBookId: \(\) => currentBookId/);
  assert.match(app, /getWorldBook: \(\) => worldBook/);
  assert.match(app, /versionHistory\.bind\(\)/);
});

test('app no longer owns version diff algorithms or version modal binder', () => {
  assert.doesNotMatch(app, /const DIFF_FIELDS/);
  assert.doesNotMatch(app, /function lineDiff\(/);
  assert.doesNotMatch(app, /function computeBookDiff\(/);
  assert.doesNotMatch(app, /function renderDiff\(/);
  assert.doesNotMatch(app, /function bindVersions\(/);
});
