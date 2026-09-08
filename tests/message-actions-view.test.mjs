import assert from 'node:assert/strict';
import test from 'node:test';

import {
  messageActionKinds,
  messageTokenPill
} from '../public/modules/ai/ui/message-actions-view.js';

test('assistant keeps resend/copy/edit/delete while user omits resend', () => {
  assert.deepEqual(messageActionKinds('assistant'), ['resend', 'copy', 'edit', 'delete']);
  assert.deepEqual(messageActionKinds('user'), ['copy', 'edit', 'delete']);
  assert.deepEqual(messageActionKinds('tool'), []);
  assert.deepEqual(messageActionKinds('error'), []);
});

test('assistant token pill preserves text, threshold and tooltip semantics', () => {
  assert.equal(messageTokenPill({ role: 'assistant' }, 16000), null);
  assert.deepEqual(messageTokenPill({ tokens: 1200 }, 16000), {
    className: 'chat-token-pill',
    text: '≈ 1,200 tok',
    title: '该轮发送给模型的上下文估算'
  });
  assert.deepEqual(messageTokenPill({ tokens: 16001 }, 16000), {
    className: 'chat-token-pill over',
    text: '≈ 16,001 tok',
    title: '该轮发送给模型的上下文估算'
  });
});
