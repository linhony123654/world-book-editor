import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates composer event binding and busy presentation to chat composer', () => {
  assert.match(chat, /createChatComposer\(\{/);
  assert.match(chat, /chatComposer\.bind\(\)/);
  assert.match(chat, /chatComposer\.setBusy\(/);
  assert.match(chat, /chatComposer\.resetInputHeight\(/);
});

test('chat no longer owns send-button, textarea-key, autosize, or composer busy DOM rules', () => {
  assert.doesNotMatch(chat, /\$btnSendChat\.addEventListener\('click'/);
  assert.doesNotMatch(chat, /\$chatInput\.addEventListener\('keydown'/);
  assert.doesNotMatch(chat, /\$chatInput\.addEventListener\('input'/);
  assert.doesNotMatch(chat, /btn\.classList\.toggle\('is-busy'/);
  assert.doesNotMatch(chat, /input\.classList\.toggle\('sending'/);
});
