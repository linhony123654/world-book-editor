import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates streaming delta aggregation to the assistant stream adapter', () => {
  assert.match(chat, /from '\.\/ai\/conversation\/stream-adapter\.js'/);
  assert.match(chat, /consumeAssistantStream\(streamSSE\(response\)/);
  assert.doesNotMatch(chat, /let toolCalls = \[\]/);
  assert.doesNotMatch(chat, /toolCalls\[idx\]\.function\.arguments \+=/);
});

test('chat keeps only presentation callbacks around the stream adapter', () => {
  assert.match(chat, /onUpdate:\s*\(\{ content, reasoning \}\) =>/);
  assert.match(chat, /renderAssistantStream\(msgEl, content, reasoning, true\)/);
  assert.match(chat, /collapseReasoningAfterStream\(msgEl, reasoning\)/);
  assert.match(chat, /renderAssistantStream\(msgEl, content, reasoning, false\)/);
});
