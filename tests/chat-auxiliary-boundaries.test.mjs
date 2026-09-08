import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chatSource = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates background completions to auxiliary client', () => {
  assert.match(chatSource, /from '\.\/ai\/auxiliary-client\.js'/);
  assert.match(chatSource, /createAuxiliaryCompletionClient/);
  assert.match(chatSource, /auxiliaryCompletionClient\.complete/);
  assert.doesNotMatch(chatSource, /const AUX_REQUEST_TIMEOUT_MS\s*=\s*60000/);
  assert.doesNotMatch(chatSource, /async function fetchCompletion\s*\(/);
});
