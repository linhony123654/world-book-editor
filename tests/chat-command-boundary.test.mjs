import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chatPath = new URL('../public/modules/chat.js', import.meta.url);
const chat = fs.readFileSync(chatPath, 'utf8');

test('chat delegates streaming transport instead of implementing the wire protocol', () => {
  assert.match(chat, /from '\.\/ai\/transport\.js'/);
  assert.doesNotMatch(chat, /async function\* streamSSE\s*\(/);
  assert.doesNotMatch(chat, /async function streamFetch\s*\(/);
});

test('chat mutating tools use the command boundary', () => {
  assert.match(chat, /from '\.\/domain\/command-runtime\.js'/);
  assert.match(chat, /CommandType\.PATCH_ENTRIES/);
  assert.match(chat, /CommandType\.MERGE_EXISTING_ENTRIES/);
  assert.match(chat, /CommandType\.SPLIT_ENTRY/);
  assert.doesNotMatch(chat, /worldBook\.entries\s*\[/);
  assert.doesNotMatch(chat, /\buidKey\s*\(/);
});

test('only the AI turn rollback boundary snapshots directly in chat', () => {
  const snapshots = chat.match(/snapshotForUndo\s*\(/g) || [];
  assert.equal(snapshots.length, 1);
  assert.match(chat, /MUTATING_TOOL_NAMES\.has\(name\)/);
});
