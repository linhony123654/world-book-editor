import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates smart-draft planning, completion and commit semantics', () => {
  assert.match(chat, /from '\.\/ai\/tools\/smart-draft\.js'/);
  assert.match(chat, /createSmartDraftOrchestrator\s*\(/);
  assert.match(chat, /\.\.\.smartDraftOrchestrator\.handlers/);
  assert.doesNotMatch(chat, /function toolCreateSmartEntry\s*\(/);
  assert.doesNotMatch(chat, /function toolPlanSmartEntry\s*\(/);
  assert.doesNotMatch(chat, /async function maybeCompleteSmartContent\s*\(/);
  assert.doesNotMatch(chat, /function commitSmartDraft\s*\(/);
});

test('chat keeps smart-draft DOM state as the controller adapter', () => {
  assert.match(chat, /function renderSmartDraftModal\s*\(/);
  assert.match(chat, /function commitActiveSmartDraft\s*\(/);
  assert.match(chat, /function discardActiveSmartDraft\s*\(/);
  assert.match(chat, /smartDraftOrchestrator\.commitDraft\(record\.draft\)/);
});
