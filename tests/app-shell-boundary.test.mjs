import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const undo = fs.readFileSync(new URL('../public/modules/app/undo-history.js', import.meta.url), 'utf8');
const entries = fs.readFileSync(new URL('../public/modules/app/entry-actions.js', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/modules/app/navigation.js', import.meta.url), 'utf8');

test('app composes shell controllers instead of owning their DOM behavior', () => {
  assert.match(app, /createNavigationController\(\{/);
  assert.match(app, /createEntryActionsController\(\{/);
  assert.match(app, /createUndoHistoryController\(\{/);
  assert.match(app, /navigation\.bind\(\)/);
  assert.match(app, /entryActions\.bind\(\)/);
  assert.match(app, /undoHistory\.bind\(\)/);
  assert.doesNotMatch(app, /function setScreen\(/);
  assert.doesNotMatch(app, /function bindNav\(/);
  assert.doesNotMatch(app, /function bindEntryActions\(/);
  assert.doesNotMatch(app, /function bindUndo\(/);
  assert.doesNotMatch(app, /function openUndoModal\(/);
  assert.doesNotMatch(app, /async function manualSave\(/);
});

test('navigation owns screen registry, nav routing and screen lifecycle hooks', () => {
  assert.match(navigation, /APP_SCREENS/);
  assert.match(navigation, /\[data-nav\]/);
  assert.match(navigation, /\[data-go\]/);
  assert.match(navigation, /renderArchives\(\)/);
  assert.match(navigation, /setSettingsTab\('pref'\)/);
});

test('entry actions owns create and save shortcuts while undo owns rollback shortcut/history', () => {
  assert.match(entries, /String\(event\.key \|\| ''\)\.toLowerCase\(\) === 's'/);
  assert.match(entries, /newEntry\(title\)/);
  assert.match(entries, /await autoSave\(\)/);
  assert.match(undo, /String\(event\.key \|\| ''\)\.toLowerCase\(\) === 'z'/);
  assert.match(undo, /restoreUndoTo\(idx\)/);
  assert.match(undo, /getUndoStack\(\)/);
});
