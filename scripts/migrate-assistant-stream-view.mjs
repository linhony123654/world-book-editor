import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
const boundaryPath = 'tests/chat-stream-view-boundary.test.mjs';
let src = fs.readFileSync(chatPath, 'utf8');

function replaceOnce(search, replacement, label) {
  const count = typeof search === 'string'
    ? src.split(search).length - 1
    : [...src.matchAll(new RegExp(search.source, search.flags.includes('g') ? search.flags : search.flags + 'g'))].length;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  src = src.replace(search, replacement);
}

replaceOnce(
  "import { extractReasoningDelta, hasVisibleAssistantStream, reasoningDetailsShouldBeOpen, shouldCollapseReasoningAfterStream } from './reasoning.js';",
  "import { extractReasoningDelta, hasVisibleAssistantStream } from './reasoning.js';",
  'reasoning import'
);

replaceOnce(
  "import { formatChatText } from './ai/ui/markdown.js';",
  "import { createAssistantStreamView } from './ai/ui/assistant-stream-view.js';",
  'stream view import'
);

replaceOnce(
  '// ===== 流式显示文本 =====\nasync function streamDisplay(response, msgEl) {',
  '// ===== 流式显示文本 =====\nconst assistantStreamView = createAssistantStreamView();\n\nasync function streamDisplay(response, msgEl) {',
  'stream view initialization'
);

replaceOnce(
  /function collapseReasoningAfterStream\(msgEl, reasoning\) \{[\s\S]*?\/\/ ===== 聊天滚动 =====/,
  `function collapseReasoningAfterStream(msgEl, reasoning) {\n  assistantStreamView.collapse(msgEl, reasoning);\n}\n\nfunction renderAssistantStream(msgEl, content, reasoning, reasoningOpen = false) {\n  assistantStreamView.render(msgEl, content, reasoning, reasoningOpen);\n}\n\n// ===== 聊天滚动 =====`,
  'legacy stream renderer block'
);

for (const forbidden of [
  'streamRenderRaf',
  'reasoningDetailsShouldBeOpen',
  'shouldCollapseReasoningAfterStream',
  'formatChatText('
]) {
  if (src.includes(forbidden)) throw new Error(`legacy stream presentation token remains in chat.js: ${forbidden}`);
}
if (!src.includes('assistantStreamView.render(') || !src.includes('assistantStreamView.collapse(')) {
  throw new Error('assistant stream view is not wired to render/collapse');
}

fs.writeFileSync(chatPath, src);

const boundaryTest = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\nconst chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');\n\ntest('chat delegates assistant stream presentation to AssistantStreamView', () => {\n  assert.match(chat, /createAssistantStreamView/);\n  assert.match(chat, /assistantStreamView\\.render\\(/);\n  assert.match(chat, /assistantStreamView\\.collapse\\(/);\n});\n\ntest('chat no longer owns stream-frame, markdown, or reasoning-detail presentation rules', () => {\n  assert.doesNotMatch(chat, /streamRenderRaf/);\n  assert.doesNotMatch(chat, /reasoningDetailsShouldBeOpen/);\n  assert.doesNotMatch(chat, /shouldCollapseReasoningAfterStream/);\n  assert.doesNotMatch(chat, /formatChatText\\(/);\n});\n`;
fs.writeFileSync(boundaryPath, boundaryTest);

console.log('Assistant stream view migration prepared.');
