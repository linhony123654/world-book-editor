import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates assistant stream presentation to AssistantStreamView', () => {
  assert.match(chat, /createAssistantStreamView/);
  assert.match(chat, /assistantStreamView\.render\(/);
  assert.match(chat, /assistantStreamView\.collapse\(/);
});

test('chat no longer owns stream-frame, markdown, or reasoning-detail presentation rules', () => {
  assert.doesNotMatch(chat, /streamRenderRaf/);
  assert.doesNotMatch(chat, /reasoningDetailsShouldBeOpen/);
  assert.doesNotMatch(chat, /shouldCollapseReasoningAfterStream/);
  assert.doesNotMatch(chat, /formatChatText\(/);
});
