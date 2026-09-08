import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

function replaceFunction(name, replacement) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('Function marker missing: ' + name);
  const brace = src.indexOf('{', start);
  if (brace < 0) throw new Error('Opening brace missing: ' + name);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('Closing brace missing: ' + name);
  src = src.slice(0, start) + replacement + src.slice(end);
}

function replaceAsyncFunction(name, replacement) {
  const marker = 'async function ' + name + '(';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('Async function marker missing: ' + name);
  const brace = src.indexOf('{', start);
  if (brace < 0) throw new Error('Opening brace missing: ' + name);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('Closing brace missing: ' + name);
  src = src.slice(0, start) + replacement + src.slice(end);
}

const importAnchor = "import { createAiDataRepository } from './ai/session/repository.js';\n";
if (!src.includes(importAnchor)) throw new Error('repository import anchor missing');
src = src.replace(importAnchor, importAnchor + "import { MEMORY_INJECTION_MAX, MEMORY_INJECTION_TIGHT, ROLLUP_EVERY, applyRollup, buildMemoryInjection as buildMemoryInjectionFromState, createTurnMemoryRecord, planRollup } from './ai/memory/policy.js';\n");

src = src.replace(/const ROLLUP_EVERY = 10;[^\n]*\n/, '');
src = src.replace(/const MEMORY_INJECTION_MAX = 8000;\nconst MEMORY_INJECTION_TIGHT = 2500;[^\n]*\n/, '');

replaceFunction('buildMemoryInjection', `function buildMemoryInjection(maxChars = MEMORY_INJECTION_MAX) {
  return buildMemoryInjectionFromState(memory, maxChars);
}`);

replaceFunction('pushTurnMemory', `function pushTurnMemory({ user, trace, reply }) {
  const toolSummary = summarizeTools(trace);
  const actionSummary = summarizeToolTraceForMemory(trace);
  const record = createTurnMemoryRecord({ user, trace, reply, actionSummary, toolSummary });
  if (!record) return;
  memory.turns.push(record);
  saveMemory();
  updateMemoryBadge();
}`);

replaceAsyncFunction('maybeRollup', `async function maybeRollup() {
  if (isRollingUp) return;
  const plan = planRollup(memory, ROLLUP_EVERY);
  if (!plan) return;
  isRollingUp = true;
  updateMemoryBadge();
  if ($('memoryModal') && $('memoryModal').classList.contains('open')) renderMemoryList();

  try {
    const text = await fetchCompletion(plan.messages);
    if (applyRollup(memory, plan, text)) saveMemory();
  } catch (e) {
    console.warn('[WBE] 记忆整合失败，下回合重试:', e.message);
  } finally {
    isRollingUp = false;
    updateMemoryBadge();
    if ($('memoryModal') && $('memoryModal').classList.contains('open')) renderMemoryList();
  }
}`);

const forbidden = [
  'const ROLLUP_EVERY = 10',
  'const MEMORY_INJECTION_MAX = 8000',
  'memory.rollups.push({ from, to, text })',
  'memory.rolledUpCount = to'
];
for (const token of forbidden) {
  if (src.includes(token)) throw new Error('Legacy memory-policy token remains: ' + token);
}
if (!src.includes('buildMemoryInjectionFromState(memory, maxChars)')) throw new Error('injection delegate missing');
if (!src.includes('createTurnMemoryRecord({ user, trace, reply, actionSummary, toolSummary })')) throw new Error('turn record delegate missing');
if (!src.includes('const plan = planRollup(memory, ROLLUP_EVERY);')) throw new Error('rollup planner delegate missing');

fs.writeFileSync(path, src);
console.log('Delegated memory injection, turn records and rollup planning to policy layer');
