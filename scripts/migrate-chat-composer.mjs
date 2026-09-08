import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
const boundaryPath = 'tests/chat-composer-boundary.test.mjs';
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
  "import { createChatRenderer } from './ai/ui/chat-renderer.js';",
  "import { createChatRenderer } from './ai/ui/chat-renderer.js';\nimport { createChatComposer } from './ai/ui/chat-composer.js';",
  'composer import'
);

replaceExact(
  '// ===== 初始化聊天（杂志风 AI 屏） =====\nexport function initChat() {',
  '// ===== 初始化聊天（杂志风 AI 屏） =====\nlet chatComposer = null;\n\nexport function initChat() {',
  'composer state'
);

replaceRegex(
  /  const \$btnSendChat = \$\('btn-send-chat'\);\n  const \$chatInput = \$\('chat-input'\);\n  const \$clear = \$\('chatClearBtn'\);\n\n  if \(\$btnSendChat\)[\s\S]*?  \}\n\n  \/\/ 记忆按钮 \+ 弹窗/,
  `  const $btnSendChat = $('btn-send-chat');\n  const $chatInput = $('chat-input');\n  const $clear = $('chatClearBtn');\n  const scroller = getChatScroller();\n  const $toBottom = $('chatToBottom');\n\n  if (chatComposer) chatComposer.dispose();\n  chatComposer = createChatComposer({\n    sendButton: $btnSendChat,\n    input: $chatInput,\n    scroller,\n    toBottomButton: $toBottom,\n    getIsSending: () => isSending,\n    onSend: () => sendChat(),\n    onStop: () => abortActiveChat('user'),\n    onScroll: updateToBottomBtn,\n    onToBottom: scrollChatToBottom\n  });\n  chatComposer.bind();\n\n  // 记忆按钮 + 弹窗`,
  'initChat composer listeners'
);

replaceRegex(
  /let isSending = false;\nfunction setSendBusy\(busy\) \{[\s\S]*?\n\}/,
  `let isSending = false;\nfunction setSendBusy(busy) {\n  isSending = !!busy;\n  if (chatComposer) chatComposer.setBusy(isSending);\n}`,
  'send busy DOM'
);

replaceExact(
  "    input.style.height = 'auto'; // 复位自动高度",
  "    if (chatComposer) chatComposer.resetInputHeight(); // 复位自动高度由 composer 管理",
  'input height reset'
);

for (const token of [
  "$chatInput.addEventListener('keydown'",
  "$chatInput.addEventListener('input'",
  "$btnSendChat.addEventListener('click'",
  "$toBottom.addEventListener('click'",
  "btn.classList.toggle('is-busy'",
  "input.classList.toggle('sending'"
]) {
  if (src.includes(token)) throw new Error(`legacy composer control remains in chat.js: ${token}`);
}
if (!src.includes('createChatComposer({') || !src.includes('chatComposer.bind()') || !src.includes('chatComposer.setBusy(')) {
  throw new Error('chat composer delegation incomplete');
}

fs.writeFileSync(chatPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');\n\ntest('chat delegates composer event binding and busy presentation to chat composer', () => {\n  assert.match(chat, /createChatComposer\\(\\{/);\n  assert.match(chat, /chatComposer\\.bind\\(\\)/);\n  assert.match(chat, /chatComposer\\.setBusy\\(/);\n  assert.match(chat, /chatComposer\\.resetInputHeight\\(/);\n});\n\ntest('chat no longer owns send-button, textarea-key, autosize, or composer busy DOM rules', () => {\n  assert.doesNotMatch(chat, /\\$btnSendChat\\.addEventListener\\('click'/);\n  assert.doesNotMatch(chat, /\\$chatInput\\.addEventListener\\('keydown'/);\n  assert.doesNotMatch(chat, /\\$chatInput\\.addEventListener\\('input'/);\n  assert.doesNotMatch(chat, /btn\\.classList\\.toggle\\('is-busy'/);\n  assert.doesNotMatch(chat, /input\\.classList\\.toggle\\('sending'/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('Chat composer migration prepared.');
