import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
const boundaryPath = 'tests/message-actions-boundary.test.mjs';
let src = fs.readFileSync(chatPath, 'utf8');

function replaceExact(search, replacement, label) {
  const count = src.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  src = src.replace(search, replacement);
}
function replaceRegex(search, replacement, label) {
  const flags = search.flags.includes('g') ? search.flags : search.flags + 'g';
  const count = [...src.matchAll(new RegExp(search.source, flags))].length;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  src = src.replace(search, replacement);
}

replaceExact(
  "import { createChatComposer } from './ai/ui/chat-composer.js';",
  "import { createChatComposer } from './ai/ui/chat-composer.js';\nimport { createMessageActionsView } from './ai/ui/message-actions-view.js';",
  'message actions import'
);

replaceRegex(
  /function attachMsgRow\(msgEl, idx\) \{[\s\S]*?\n  host\.appendChild\(row\);\n\}/,
  `const messageActionsView = createMessageActionsView({\n  documentRef: document,\n  getMessages: () => chatMessages,\n  getTokenBudget: () => TOKEN_BUDGET,\n  onResend: () => resendLast(),\n  onCopy: i => copyMsgText(i),\n  onEdit: (i, msgEl) => startEditMsg(msgEl, i),\n  onDelete: (i, msgEl) => deleteMsg(i, msgEl)\n});\n\nfunction attachMsgRow(msgEl, idx) {\n  return messageActionsView.attach(msgEl, idx);\n}`,
  'message action row DOM'
);

for (const token of [
  "row.className = 'chat-msg-actions'",
  "resend.innerHTML =",
  "copy.innerHTML =",
  "edit.innerHTML =",
  "del.innerHTML =",
  "pill.className = 'chat-token-pill'"
]) {
  if (src.includes(token)) throw new Error(`legacy action-row DOM remains in chat.js: ${token}`);
}
if (!src.includes('createMessageActionsView({') || !src.includes('messageActionsView.attach(')) {
  throw new Error('message actions view delegation incomplete');
}

fs.writeFileSync(chatPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');\n\ntest('chat delegates message action-row presentation while retaining controller callbacks', () => {\n  assert.match(chat, /createMessageActionsView\\(\\{/);\n  assert.match(chat, /messageActionsView\\.attach\\(/);\n  assert.match(chat, /onCopy: i => copyMsgText\\(i\\)/);\n  assert.match(chat, /onEdit: \\(i, msgEl\\) => startEditMsg\\(msgEl, i\\)/);\n  assert.match(chat, /onDelete: \\(i, msgEl\\) => deleteMsg\\(i, msgEl\\)/);\n});\n\ntest('chat no longer constructs resend/copy/edit/delete buttons or token pill DOM', () => {\n  assert.doesNotMatch(chat, /row\\.className = 'chat-msg-actions'/);\n  assert.doesNotMatch(chat, /resend\\.innerHTML =/);\n  assert.doesNotMatch(chat, /copy\\.innerHTML =/);\n  assert.doesNotMatch(chat, /edit\\.innerHTML =/);\n  assert.doesNotMatch(chat, /del\\.innerHTML =/);\n  assert.doesNotMatch(chat, /pill\\.className = 'chat-token-pill'/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);
console.log('Message actions view migration prepared.');
