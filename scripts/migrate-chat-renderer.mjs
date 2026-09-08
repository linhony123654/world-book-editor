import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
const boundaryPath = 'tests/chat-renderer-boundary.test.mjs';
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
  "import { createAssistantStreamView } from './ai/ui/assistant-stream-view.js';",
  "import { createAssistantStreamView } from './ai/ui/assistant-stream-view.js';\nimport { createChatRenderer } from './ai/ui/chat-renderer.js';",
  'chat renderer import'
);

replaceRegex(
  /\/\/ ===== 创建 AI 消息占位 =====\nfunction createAssistantBubble\(\) \{[\s\S]*?\n\}\n\n\/\/ ===== 发送按钮忙碌态 =====/,
  `// ===== Chat DOM renderer =====\nconst chatRenderer = createChatRenderer({\n  documentRef: document,\n  getContainer: () => $('chat-messages'),\n  getMessageCount: () => chatMessages.length,\n  attachAssistantActions: (el, idx) => attachResendBtn(el, idx),\n  attachUserActions: (el, idx) => attachMsgActions(el, idx),\n  applyVisibleLimit: applyChatVisibleLimit,\n  isNearBottom: isChatNearBottom,\n  scrollToBottom: scrollChatToBottom,\n  onOpenEntry: uid => {\n    selectEntry(uid);\n    document.dispatchEvent(new CustomEvent('wbe:goto-editor'));\n  },\n  onUndoTurn: base => undoThisTurn(base),\n  getTurnUndoBase: () => turnUndoBase\n});\n\nfunction createAssistantBubble() {\n  return chatRenderer.createAssistantBubble();\n}\n\n// ===== 发送按钮忙碌态 =====`,
  'assistant bubble block'
);

replaceRegex(
  /function appendChatMessage\(role, text, idx\) \{[\s\S]*?\n\}\n\n\/\/ ===== 本轮改动卡片：回合内条目级改动汇总，可点条目跳转、一键撤销本轮 =====/,
  `function appendChatMessage(role, text, idx) {\n  return chatRenderer.appendMessage(role, text, idx);\n}\n\n// ===== 本轮改动卡片：回合内条目级改动汇总，可点条目跳转、一键撤销本轮 =====`,
  'appendChatMessage block'
);

replaceRegex(
  /function appendChangesCard\(changes\) \{[\s\S]*?\n\}\n\n\/\/ 一键撤销本轮全部改动/,
  `function appendChangesCard(changes) {\n  return chatRenderer.appendChangesCard(changes);\n}\n\n// 一键撤销本轮全部改动`,
  'appendChangesCard block'
);

replaceRegex(
  /\/\/ 把连续的工具调用收进一个可展开分组（默认收起）\nfunction appendToolLine\(container, text\) \{[\s\S]*?\n\}\n\nconst mutationToolHandlers/,
  `const mutationToolHandlers`,
  'appendToolLine block'
);

for (const token of [
  "document.createElement('details')",
  "className = 'tool-group'",
  "className = 'chat-msg chat-msg-changes'",
  "const icons = { add:",
  "if (role === 'tool') { appendToolLine"
]) {
  if (src.includes(token)) throw new Error(`legacy chat renderer token remains: ${token}`);
}
if (!src.includes('createChatRenderer({') || !src.includes('chatRenderer.appendMessage(') || !src.includes('chatRenderer.appendChangesCard(')) {
  throw new Error('chat renderer delegation is incomplete');
}

fs.writeFileSync(chatPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');\n\ntest('chat delegates message, tool-trace, changes-card and assistant-bubble DOM to chat renderer', () => {\n  assert.match(chat, /createChatRenderer\\(\\{/);\n  assert.match(chat, /chatRenderer\\.appendMessage\\(/);\n  assert.match(chat, /chatRenderer\\.appendChangesCard\\(/);\n  assert.match(chat, /chatRenderer\\.createAssistantBubble\\(/);\n});\n\ntest('chat keeps behavior callbacks but no longer constructs tool/change presentation DOM', () => {\n  assert.match(chat, /onOpenEntry:/);\n  assert.match(chat, /onUndoTurn:/);\n  assert.match(chat, /attachAssistantActions:/);\n  assert.doesNotMatch(chat, /className = 'tool-group'/);\n  assert.doesNotMatch(chat, /className = 'chat-msg chat-msg-changes'/);\n  assert.doesNotMatch(chat, /const icons = \\{ add:/);\n  assert.doesNotMatch(chat, /function appendToolLine\\(/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('Chat renderer migration prepared.');
