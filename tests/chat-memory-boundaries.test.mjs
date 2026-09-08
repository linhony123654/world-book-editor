import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chatSource = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates memory policy and rollup semantics', () => {
  assert.match(chatSource, /from '\.\/ai\/memory\/policy\.js'/);
  assert.match(chatSource, /buildMemoryInjectionFromState/);
  assert.match(chatSource, /createTurnMemoryRecord/);
  assert.match(chatSource, /planRollup/);
  assert.match(chatSource, /applyRollup/);

  assert.doesNotMatch(chatSource, /const ROLLUP_EVERY\s*=\s*10/);
  assert.doesNotMatch(chatSource, /const MEMORY_INJECTION_MAX\s*=\s*8000/);
  assert.doesNotMatch(chatSource, /memory\.rollups\.push\(\{\s*from,\s*to,\s*text\s*\}\)/);
  assert.doesNotMatch(chatSource, /memory\.rolledUpCount\s*=\s*to/);
});
