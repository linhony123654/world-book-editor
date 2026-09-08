import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

const importAnchor = "import { streamFetch, streamSSE } from './ai/transport.js';\n";
if (!src.includes(importAnchor)) throw new Error('transport import anchor missing');
src = src.replace(importAnchor, importAnchor + "import { createAuxiliaryCompletionClient } from './ai/auxiliary-client.js';\n");

const startMarker = '// 附属 AI 请求（标题生成/记忆总结/正文补全/模板生成）统一带 60s 超时，避免上游挂起卡死';
const endMarker = '// ===== AI 会话标题：首条消息后异步生成，失败回退截取法 =====';
const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('auxiliary completion block markers missing');

const replacement = `// 附属 AI 请求（标题生成/记忆总结/正文补全/模板生成）统一走独立 completion client。
const auxiliaryCompletionClient = createAuxiliaryCompletionClient({
  getConfig: () => ({
    apiUrl: localStorage.getItem('wbe-api-url'),
    apiKey: localStorage.getItem('wbe-api-key'),
    model: localStorage.getItem('wbe-model') || 'gpt-4o'
  })
});
function completeAuxiliary(messages, opts = {}) {
  return auxiliaryCompletionClient.complete(messages, opts);
}

`;

src = src.slice(0, start) + replacement + src.slice(end);
src = src.replace(/\bfetchCompletion\(/g, 'completeAuxiliary(');

if (!src.includes("import { createAuxiliaryCompletionClient } from './ai/auxiliary-client.js';")) throw new Error('auxiliary client import missing');
if (src.includes('const AUX_REQUEST_TIMEOUT_MS = 60000')) throw new Error('legacy auxiliary timeout constant remains');
if (src.includes('async function fetchCompletion')) throw new Error('legacy fetchCompletion remains');
if (!src.includes('return auxiliaryCompletionClient.complete(messages, opts);')) throw new Error('auxiliary client delegate missing');

fs.writeFileSync(path, src);
console.log('Delegated auxiliary completion requests to ai/auxiliary-client.js');
