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

test('chat delegates mutating entry tools to the world-book mutation adapter', () => {
  const mutationPath = new URL('../public/modules/ai/tools/worldbook-mutation.js', import.meta.url);
  const mutation = fs.readFileSync(mutationPath, 'utf8');
  assert.match(chat, /from '\.\/ai\/tools\/worldbook-mutation\.js'/);
  assert.match(chat, /createWorldBookMutationHandlers\s*\(/);
  assert.match(chat, /\.\.\.mutationToolHandlers/);
  assert.doesNotMatch(chat, /function toolEdit\s*\(/);
  assert.doesNotMatch(chat, /function toolDeleteMany\s*\(/);
  assert.doesNotMatch(chat, /function toolMergeEntries\s*\(/);
  assert.match(mutation, /CommandType\.PATCH_ENTRIES/);
  assert.match(mutation, /CommandType\.MERGE_EXISTING_ENTRIES/);
  assert.match(mutation, /CommandType\.SPLIT_ENTRY/);
  assert.doesNotMatch(chat, /worldBook\.entries\s*\[/);
  assert.doesNotMatch(chat, /\buidKey\s*\(/);
});

test('only the AI turn rollback boundary snapshots directly in chat', () => {
  const snapshots = chat.match(/snapshotForUndo\s*\(/g) || [];
  assert.equal(snapshots.length, 1);
  assert.match(chat, /MUTATING_TOOL_NAMES\.has\(name\)/);
});
