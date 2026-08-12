import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeChatVisibleLimit, visibleChatStartIndex } from '../modules/chat-view.js';

test('normalizes chat visible limit with default 10', () => {
  assert.equal(normalizeChatVisibleLimit(null), 10);
  assert.equal(normalizeChatVisibleLimit(''), 10);
  assert.equal(normalizeChatVisibleLimit('8'), 8);
  assert.equal(normalizeChatVisibleLimit('0'), 0);
});

test('clamps unreasonable chat visible limits', () => {
  assert.equal(normalizeChatVisibleLimit('-1'), 10);
  assert.equal(normalizeChatVisibleLimit('999'), 200);
  assert.equal(normalizeChatVisibleLimit('abc'), 10);
});

test('computes first visible index while zero means show all', () => {
  assert.equal(visibleChatStartIndex(25, 10), 15);
  assert.equal(visibleChatStartIndex(5, 10), 0);
  assert.equal(visibleChatStartIndex(25, 0), 0);
});
