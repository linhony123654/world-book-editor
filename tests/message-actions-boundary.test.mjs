import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates message action-row presentation while retaining controller callbacks', () => {
  assert.match(chat, /createMessageActionsView\(\{/);
  assert.match(chat, /messageActionsView\.attach\(/);
  assert.match(chat, /onCopy: i => copyMsgText\(i\)/);
  assert.match(chat, /onEdit: \(i, msgEl\) => startEditMsg\(msgEl, i\)/);
  assert.match(chat, /onDelete: \(i, msgEl\) => deleteMsg\(i, msgEl\)/);
});

test('chat no longer constructs resend/copy/edit/delete buttons or token pill DOM', () => {
  assert.doesNotMatch(chat, /row\.className = 'chat-msg-actions'/);
  assert.doesNotMatch(chat, /resend\.innerHTML =/);
  assert.doesNotMatch(chat, /copy\.innerHTML =/);
  assert.doesNotMatch(chat, /edit\.innerHTML =/);
  assert.doesNotMatch(chat, /del\.innerHTML =/);
  assert.doesNotMatch(chat, /pill\.className = 'chat-token-pill'/);
});
