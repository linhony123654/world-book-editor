import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');
const copyBlock = chat.match(/async function copyMsgText\(i\) \{[\s\S]*?\n\}(?=\n\nconst messageActionsView)/)?.[0] || '';
const editBlock = chat.match(/function startEditMsg\(msgEl, idx\) \{[\s\S]*?\n\}(?=\n\nfunction deleteMsg)/)?.[0] || '';

test('chat delegates inline message edit DOM and message-copy platform fallback', () => {
  assert.match(chat, /createMessageEditView\(\{/);
  assert.match(chat, /messageEditView\.start\(/);
  assert.match(copyBlock, /await copyText\(/);
});

test('message edit/copy blocks retain orchestration but no longer own platform or DOM mechanics', () => {
  assert.match(chat, /cur\.content = value/);
  assert.match(chat, /saveChatHistory\(\)/);
  assert.doesNotMatch(copyBlock, /navigator\.clipboard/);
  assert.doesNotMatch(copyBlock, /document\.execCommand\('copy'\)/);
  assert.doesNotMatch(copyBlock, /document\.createElement\('textarea'\)/);
  assert.doesNotMatch(editBlock, /document\.createElement\('textarea'\)/);
  assert.doesNotMatch(editBlock, /chat-msg-edit-textarea/);
  assert.doesNotMatch(editBlock, /chat-msg-edit-actions/);
});
