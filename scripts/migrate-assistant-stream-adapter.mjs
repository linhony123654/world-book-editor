import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
let chat = fs.readFileSync(chatPath, 'utf8');

const engineImport = "import { runConversationTurn } from './ai/conversation/engine.js';\n";
const streamImport = "import { consumeAssistantStream } from './ai/conversation/stream-adapter.js';\n";
if (!chat.includes(streamImport)) {
  if (!chat.includes(engineImport)) throw new Error('conversation engine import anchor missing');
  chat = chat.replace(engineImport, engineImport + streamImport);
}

const start = chat.indexOf('// ===== 流式显示文本 =====\nasync function streamDisplay(response, msgEl) {');
const end = chat.indexOf('\nfunction collapseReasoningAfterStream(msgEl, reasoning) {', start);
if (start < 0 || end < 0) throw new Error('legacy streamDisplay boundary missing');

const replacement = `// ===== 流式显示文本 =====
async function streamDisplay(response, msgEl) {
  return consumeAssistantStream(streamSSE(response), {
    extractReasoning: extractReasoningDelta,
    onUpdate: ({ content, reasoning }) => {
      renderAssistantStream(msgEl, content, reasoning, true);
      if (isChatNearBottom()) scrollChatToBottom();
    },
    onComplete: ({ content, reasoning }) => {
      collapseReasoningAfterStream(msgEl, reasoning);
      // 冲刷最后一帧：rAF 节流下最后一帧可能仍在排队，这里同步补一帧收尾。
      renderAssistantStream(msgEl, content, reasoning, false);
    }
  });
}
`;
chat = chat.slice(0, start) + replacement + chat.slice(end);

if (!chat.includes('consumeAssistantStream(streamSSE(response)')) throw new Error('stream adapter delegation missing');
if (chat.includes('let toolCalls = [];')) throw new Error('legacy stream tool-call accumulator remains in chat');
if (chat.includes('toolCalls[idx].function.arguments +=')) throw new Error('legacy tool-call delta merge remains in chat');
fs.writeFileSync(chatPath, chat);

fs.writeFileSync('tests/chat-stream-boundary.test.mjs', `import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates streaming delta aggregation to the assistant stream adapter', () => {
  assert.match(chat, /from '\\.\\/ai\\/conversation\\/stream-adapter\\.js'/);
  assert.match(chat, /consumeAssistantStream\\(streamSSE\\(response\\)/);
  assert.doesNotMatch(chat, /let toolCalls = \\[\\]/);
  assert.doesNotMatch(chat, /toolCalls\\[idx\\]\\.function\\.arguments \\+=/);
});

test('chat keeps only presentation callbacks around the stream adapter', () => {
  assert.match(chat, /onUpdate:\\s*\\(\\{ content, reasoning \\}\\) =>/);
  assert.match(chat, /renderAssistantStream\\(msgEl, content, reasoning, true\\)/);
  assert.match(chat, /collapseReasoningAfterStream\\(msgEl, reasoning\\)/);
  assert.match(chat, /renderAssistantStream\\(msgEl, content, reasoning, false\\)/);
});
`);

console.log('Migrated assistant stream aggregation out of chat.js');
