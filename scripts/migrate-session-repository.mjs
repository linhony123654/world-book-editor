import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

const importAnchor = "import { addSessionTokens, createSession as makeSession, emptyMemory, enforceMemoryLimits, normalizeMemory, normalizeSessionList, pruneSessions, recentMemoryTurns, selectActiveSession, titleFromMessages, updateSessionFromChat, visibleMessagesFromSession } from './ai/session/model.js';\n";
if (!src.includes(importAnchor)) throw new Error('session model import anchor missing');
src = src.replace(importAnchor, importAnchor + "import { createAiDataRepository } from './ai/session/repository.js';\n");

const start = src.indexOf('// ===== 会话/记忆持久化：后端 SQLite（容量不受 localStorage 限制），localStorage 仅作一次性迁移源 =====');
const end = src.indexOf('// 把损坏的本地数据备份到 wbe-corrupt-backup，避免坏数据被静默重置丢失', start);
if (start < 0 || end < 0) throw new Error('persistence block markers missing');

const replacement = `// ===== 会话/记忆持久化：后端 SQLite（容量不受 localStorage 限制），localStorage 仅作一次性迁移源 =====
// 网络、鉴权与串行 PUT 由 repository 层负责；chat.js 只保留兼容调用名。
const aiDataRepository = createAiDataRepository({
  fetchImpl: (...args) => fetch(...args),
  getAuthHeaders: async () => {
    const { authHeaders } = await import('./auth.js');
    return authHeaders();
  },
  onWriteError: (error, bookId) => {
    console.warn('[WBE] 持久化失败（book ' + bookId + '）:', error.message);
  }
});
function persistPut(bookId, payload) {
  return aiDataRepository.write(bookId, payload);
}
function persistFetch(bookId) {
  return aiDataRepository.read(bookId);
}

`;

src = src.slice(0, start) + replacement + src.slice(end);

if (!src.includes("import { createAiDataRepository } from './ai/session/repository.js';")) throw new Error('repository import not installed');
if (src.includes('let persistQueue = Promise.resolve()')) throw new Error('legacy write queue remains');
if (src.includes("fetch('/api/ai-data/'")) throw new Error('direct ai-data fetch remains');
if ((src.match(/function persistPut\(/g) || []).length !== 1) throw new Error('unexpected persistPut count');
if ((src.match(/function persistFetch\(/g) || []).length !== 1) throw new Error('unexpected persistFetch count');

fs.writeFileSync(path, src);
console.log('Delegated AI session persistence to repository layer');
