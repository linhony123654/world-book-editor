import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

const transportImport = "import { streamFetch, streamSSE } from './ai/transport.js';\n";
if (!src.includes(transportImport.trim())) {
  const importRe = /import \{ WRITING_TEMPLATE_FIELDS,[^\n]+\} from '\.\/writing-template\.js';\n/;
  const match = src.match(importRe);
  if (!match) throw new Error('writing-template import anchor not found');
  src = src.replace(importRe, match[0] + transportImport);
}

const startMarker = '// ===== 流式 SSE 解析 =====';
const endMarker = '// ===== 流式显示文本 =====';
const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker);

if (start >= 0) {
  if (end < 0 || end <= start) throw new Error('stream display boundary not found after SSE block');
  src = src.slice(0, start) + endMarker + src.slice(end + endMarker.length);
}

if (!src.includes(transportImport.trim())) throw new Error('transport import missing after migration');
if (src.includes('async function* streamSSE(')) throw new Error('local streamSSE still exists');
if (src.includes('async function streamFetch(')) throw new Error('local streamFetch still exists');
if (!src.includes('streamFetch(apiUrl, apiKey')) throw new Error('chat no longer calls streamFetch');
if (!src.includes('for await (const chunk of streamSSE(')) throw new Error('chat no longer calls streamSSE');

fs.writeFileSync(path, src);
console.log('chat transport extraction applied');
