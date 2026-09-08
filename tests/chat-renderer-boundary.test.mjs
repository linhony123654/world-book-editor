import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates message, tool-trace, changes-card and assistant-bubble DOM to chat renderer', () => {
  assert.match(chat, /createChatRenderer\(\{/);
  assert.match(chat, /chatRenderer\.appendMessage\(/);
  assert.match(chat, /chatRenderer\.appendChangesCard\(/);
  assert.match(chat, /chatRenderer\.createAssistantBubble\(/);
});

test('chat keeps behavior callbacks but no longer constructs tool/change presentation DOM', () => {
  assert.match(chat, /onOpenEntry:/);
  assert.match(chat, /onUndoTurn:/);
  assert.match(chat, /attachAssistantActions:/);
  assert.doesNotMatch(chat, /className = 'tool-group'/);
  assert.doesNotMatch(chat, /className = 'chat-msg chat-msg-changes'/);
  assert.doesNotMatch(chat, /const icons = \{ add:/);
  assert.doesNotMatch(chat, /function appendToolLine\(/);
});
