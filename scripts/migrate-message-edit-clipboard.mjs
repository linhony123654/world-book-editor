import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
const boundaryPath = 'tests/message-edit-clipboard-boundary.test.mjs';
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
  "import { createMessageActionsView } from './ai/ui/message-actions-view.js';",
  "import { createMessageActionsView } from './ai/ui/message-actions-view.js';\nimport { createMessageEditView } from './ai/ui/message-edit-view.js';\nimport { copyText } from './ai/ui/clipboard.js';",
  'message edit and clipboard imports'
);

replaceRegex(
  /function copyMsgText\(i\) \{[\s\S]*?\n\}/,
  `async function copyMsgText(i) {\n  const m = chatMessages[i];\n  const text = m ? String(m.content || '') : '';\n  if (!text) {\n    import('./utils.js').then(u => u.showToast('没有可复制的内容', 'info'));\n    return;\n  }\n  try {\n    const copied = await copyText(text, { navigatorRef: navigator, documentRef: document });\n    import('./utils.js').then(u => u.showToast(copied ? '已复制到剪贴板' : '复制失败', copied ? 'success' : 'error'));\n  } catch (e) {\n    console.warn('[WBE] 复制消息失败:', e);\n    import('./utils.js').then(u => u.showToast('复制失败', 'error'));\n  }\n}`,
  'copyMsgText implementation'
);

replaceExact(
  "function attachResendBtn(msgEl, idx) { attachMsgRow(msgEl, idx); }\nfunction attachMsgActions(msgEl, idx) { attachMsgRow(msgEl, idx); }\n\nfunction startEditMsg(msgEl, idx) {",
  `function attachResendBtn(msgEl, idx) { attachMsgRow(msgEl, idx); }\nfunction attachMsgActions(msgEl, idx) { attachMsgRow(msgEl, idx); }\n\nconst messageEditView = createMessageEditView({\n  documentRef: document,\n  onEmpty: () => import('./utils.js').then(m => m.showToast('内容不能为空', 'error')),\n  onCancel: () => renderChatHistory(),\n  onSave: (i, value) => {\n    const cur = chatMessages[i];\n    if (!cur) return;\n    cur.content = value;\n    // 首条 user 消息变化时同步会话标题（未 AI 命名时）\n    const s = sessions.find(x => x.id === activeSessionId);\n    if (s && !s.aiTitled) s.title = titleFromMessages(chatMessages);\n    saveChatHistory();\n    renderChatHistory(); // 全量重渲染，统一恢复编辑/删除按钮与索引\n    import('./utils.js').then(m => m.showToast('已更新消息', 'success'));\n  }\n});\n\nfunction startEditMsg(msgEl, idx) {`,
  'message edit view initialization'
);

replaceRegex(
  /function startEditMsg\(msgEl, idx\) \{[\s\S]*?\n\}\n\nfunction deleteMsg/,
  `function startEditMsg(msgEl, idx) {\n  const i = idx != null ? Number(idx) : -1;\n  if (i < 0 || i >= chatMessages.length) return;\n  const cur = chatMessages[i];\n  if (!cur) return;\n  return messageEditView.start(msgEl, i, cur.content);\n}\n\nfunction deleteMsg`,
  'startEditMsg DOM implementation'
);

const copyBlock = src.match(/async function copyMsgText\(i\) \{[\s\S]*?\n\}(?=\n\nconst messageActionsView)/)?.[0] || '';
for (const token of ['navigator.clipboard', "document.execCommand('copy')", "document.createElement('textarea')"]) {
  if (copyBlock.includes(token)) throw new Error(`legacy message-copy platform token remains: ${token}`);
}
const editBlock = src.match(/function startEditMsg\(msgEl, idx\) \{[\s\S]*?\n\}(?=\n\nfunction deleteMsg)/)?.[0] || '';
for (const token of ["document.createElement('textarea')", "className = 'chat-msg-edit-textarea'", "className = 'chat-msg-edit-actions'"]) {
  if (editBlock.includes(token)) throw new Error(`legacy message-edit DOM token remains: ${token}`);
}
if (!src.includes('createMessageEditView({') || !src.includes('messageEditView.start(') || !src.includes('await copyText(')) {
  throw new Error('message edit / clipboard delegation incomplete');
}

fs.writeFileSync(chatPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');\nconst copyBlock = chat.match(/async function copyMsgText\\(i\\) \\{[\\s\\S]*?\\n\\}(?=\\n\\nconst messageActionsView)/)?.[0] || '';\nconst editBlock = chat.match(/function startEditMsg\\(msgEl, idx\\) \\{[\\s\\S]*?\\n\\}(?=\\n\\nfunction deleteMsg)/)?.[0] || '';\n\ntest('chat delegates inline message edit DOM and message-copy platform fallback', () => {\n  assert.match(chat, /createMessageEditView\\(\\{/);\n  assert.match(chat, /messageEditView\\.start\\(/);\n  assert.match(copyBlock, /await copyText\\(/);\n});\n\ntest('message edit/copy blocks retain orchestration but no longer own platform or DOM mechanics', () => {\n  assert.match(chat, /cur\\.content = value/);\n  assert.match(chat, /saveChatHistory\\(\\)/);\n  assert.doesNotMatch(copyBlock, /navigator\\.clipboard/);\n  assert.doesNotMatch(copyBlock, /document\\.execCommand\\('copy'\\)/);\n  assert.doesNotMatch(copyBlock, /document\\.createElement\\('textarea'\\)/);\n  assert.doesNotMatch(editBlock, /document\\.createElement\\('textarea'\\)/);\n  assert.doesNotMatch(editBlock, /chat-msg-edit-textarea/);\n  assert.doesNotMatch(editBlock, /chat-msg-edit-actions/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('Message edit + clipboard migration prepared.');
