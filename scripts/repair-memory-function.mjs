import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

const stale = `) {
  const toolSummary = summarizeTools(trace);
  const actionSummary = summarizeToolTraceForMemory(trace);
  const cleanReply = (reply || '').trim();
  if (!actionSummary && (!cleanReply || cleanReply === '(无回复)')) return;
  memory.turns.push({
    user: (user || '').slice(0, 200),
    actionSummary,
    toolSummary,
    toolDetail: (trace || []).slice(-20),
    reply: cleanReply.slice(0, 400),
    ts: Date.now()
  });
  saveMemory();
  updateMemoryBadge();
}
`;

const marker = `function pushTurnMemory({ user, trace, reply }) {
  const toolSummary = summarizeTools(trace);
  const actionSummary = summarizeToolTraceForMemory(trace);
  const record = createTurnMemoryRecord({ user, trace, reply, actionSummary, toolSummary });
  if (!record) return;
  memory.turns.push(record);
  saveMemory();
  updateMemoryBadge();
}`;

const markerIndex = src.indexOf(marker);
if (markerIndex < 0) throw new Error('new pushTurnMemory implementation missing');
const staleIndex = src.indexOf(stale, markerIndex + marker.length);
if (staleIndex !== markerIndex + marker.length + 1) {
  throw new Error('stale pushTurnMemory remainder not found at expected boundary: ' + staleIndex);
}
src = src.slice(0, staleIndex) + src.slice(staleIndex + stale.length);

if ((src.match(/function pushTurnMemory\(/g) || []).length !== 1) throw new Error('unexpected pushTurnMemory count');
if (src.includes("const cleanReply = (reply || '').trim();")) throw new Error('legacy pushTurnMemory body still present');

fs.writeFileSync(path, src);
console.log('Removed stale pushTurnMemory body left by destructured-parameter migration');
