import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates book-level command semantics to the book tool adapter', () => {
  assert.match(chat, /from '\.\/ai\/tools\/book-tools\.js'/);
  assert.match(chat, /createBookToolHandlers\s*\(/);
  assert.match(chat, /\.\.\.bookToolHandlers/);
  assert.doesNotMatch(chat, /function toolSwitchBook\s*\(/);
  assert.doesNotMatch(chat, /function toolDeleteBook\s*\(/);
});

test('chat keeps only current-book lifecycle callbacks at the controller boundary', () => {
  assert.match(chat, /function cleanupDeletedBookLocalData\s*\(/);
  assert.match(chat, /async function handleDeletedCurrentBook\s*\(/);
  assert.match(chat, /onDeletedCurrentBook:\s*handleDeletedCurrentBook/);
});
