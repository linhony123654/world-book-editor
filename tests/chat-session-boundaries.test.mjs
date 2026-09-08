import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chatSource = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates session model semantics', () => {
  assert.match(chatSource, /from '\.\/ai\/session\/model\.js'/);
  assert.doesNotMatch(chatSource, /function makeSession\s*\(/);
  assert.doesNotMatch(chatSource, /function normalizeMemory\s*\(/);
  assert.doesNotMatch(chatSource, /const MAX_SESSIONS\s*=/);
  assert.doesNotMatch(chatSource, /const MAX_MEMORY_TURNS\s*=/);
});

test('chat delegates ai-data persistence to repository', () => {
  assert.match(chatSource, /createAiDataRepository/);
  assert.match(chatSource, /from '\.\/ai\/session\/repository\.js'/);
  assert.doesNotMatch(chatSource, /let persistQueue\s*=\s*Promise\.resolve\(\)/);
  assert.doesNotMatch(chatSource, /fetch\(['"]\/api\/ai-data\//);
});
