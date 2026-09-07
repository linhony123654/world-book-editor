import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

function replaceExact(before, after, label) {
  if (!src.includes(before)) throw new Error('Missing marker: ' + label);
  src = src.replace(before, after);
}

const importAnchor = "import { runConversationTurn } from './ai/conversation/engine.js';\n";
replaceExact(importAnchor, importAnchor + "import { addSessionTokens, createSession as makeSession, emptyMemory, enforceMemoryLimits, normalizeMemory, normalizeSessionList, pruneSessions, recentMemoryTurns, selectActiveSession, titleFromMessages, updateSessionFromChat, visibleMessagesFromSession } from './ai/session/model.js';\n", 'session model import');

replaceExact(`const MAX_MEMORY_TURNS = 100;   // 记忆小总结保留上限（超出丢弃最旧的）
const MAX_MEMORY_ROLLUPS = 10;  // 阶段总结保留上限
let memory = { turns: [], rollups: [], rolledUpCount: 0 };
let logBookId = null;     // 当前已加载记忆的 bookId
let isRollingUp = false;  // 大总结进行中锁
const ROLLUP_EVERY = 10;  // 每满 N 条小总结整合一次

function memKey(bookId) { return 'wbe-memory:' + (bookId || 'unsaved'); }
function emptyMemory() { return { turns: [], rollups: [], rolledUpCount: 0 }; }
`, `let memory = emptyMemory();
let logBookId = null;     // 当前已加载记忆的 bookId
let isRollingUp = false;  // 大总结进行中锁
const ROLLUP_EVERY = 10;  // 每满 N 条小总结整合一次

function memKey(bookId) { return 'wbe-memory:' + (bookId || 'unsaved'); }
`, 'memory constants/local emptyMemory');

replaceExact(`    // 上限控制：超出丢弃最旧的；优先丢弃已被大总结覆盖的最旧部分，保持 rolledUpCount 语义
    if (memory.turns.length > MAX_MEMORY_TURNS) {
      const excess = memory.turns.length - MAX_MEMORY_TURNS;
      const dropFromRolled = Math.min(excess, memory.rolledUpCount);
      if (dropFromRolled > 0) {
        memory.turns.splice(0, dropFromRolled);
        memory.rolledUpCount -= dropFromRolled;
      }
      if (memory.turns.length > MAX_MEMORY_TURNS) {
        memory.turns.splice(0, memory.turns.length - MAX_MEMORY_TURNS);
        if (memory.rolledUpCount > memory.turns.length) memory.rolledUpCount = memory.turns.length;
      }
    }
    if (memory.rollups.length > MAX_MEMORY_ROLLUPS) memory.rollups = memory.rollups.slice(-MAX_MEMORY_ROLLUPS);
`, `    // 会话模型统一执行记忆上限规则，保持 rolledUpCount 语义。
    enforceMemoryLimits(memory);
`, 'memory limits');

replaceExact(`function recentTurns() { return memory.turns.slice(memory.rolledUpCount); }`, `function recentTurns() { return recentMemoryTurns(memory); }`, 'recent memory turns');

replaceExact(`const MAX_SESSIONS = 20; // 每本书最多保留的会话数（超出丢弃最旧不活跃的）

let sessions = [];          // 当前书的会话列表
let activeSessionId = null; // 活动会话 id

function makeSession() {
  return { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now(), aiTitled: false, memory: emptyMemory(), tokensTotal: 0 };
}
`, `let sessions = [];          // 当前书的会话列表
let activeSessionId = null; // 活动会话 id
`, 'session constant/local factory');

replaceExact(`function accumulateSessionTokens() {
  const cur = sessions.find(s => s.id === activeSessionId);
  if (cur) cur.tokensTotal = (cur.tokensTotal || 0) + (lastTokensTotal || 0);
}

function titleFromMessages(msgs) {
  const first = msgs.find(m => m.role === 'user');
  if (!first) return '新对话';
  const t = String(first.content || '').replace(/\\s+/g, ' ').trim();
  return t.length > 14 ? t.slice(0, 14) + '…' : (t || '新对话');
}
`, `function accumulateSessionTokens() {
  const cur = sessions.find(s => s.id === activeSessionId);
  addSessionTokens(cur, lastTokensTotal);
}
`, 'token/title helpers');

replaceExact(`  sessions = (list || []).filter(s => s && Array.isArray(s.messages));
  const target = sessions.find(s => s.id === activeId) || sessions[sessions.length - 1] || null;
  activeSessionId = target ? target.id : null;
  chatMessages.length = 0;
  if (target) {
    for (const m of target.messages) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') chatMessages.push({ role: m.role, content: m.content });
    }
`, `  sessions = normalizeSessionList(list);
  const target = selectActiveSession(sessions, activeId);
  activeSessionId = target ? target.id : null;
  chatMessages.length = 0;
  if (target) {
    chatMessages.push(...visibleMessagesFromSession(target));
`, 'loaded session normalization');

replaceExact(`// 记忆归一：容忍缺字段/旧结构
function normalizeMemory(m) {
  return { turns: (m && m.turns) || [], rollups: (m && m.rollups) || [], rolledUpCount: (m && m.rolledUpCount) || 0 };
}

`, '', 'local normalizeMemory');

replaceExact(`    const cur = sessions.find(s => s.id === activeSessionId);
    if (cur) {
      cur.messages = chatMessages.slice();
      cur.updatedAt = Date.now();
      if (!cur.aiTitled && (!cur.title || cur.title === '新对话')) cur.title = titleFromMessages(chatMessages);
    }
    // 会话数上限：保留最近更新的 MAX_SESSIONS 个（活动会话始终保留）
    if (sessions.length > MAX_SESSIONS) {
      const active = sessions.find(s => s.id === activeSessionId);
      const others = sessions.filter(s => s.id !== activeSessionId)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, MAX_SESSIONS - (active ? 1 : 0));
      sessions.length = 0;
      if (active) sessions.push(active);
      sessions.push(...others);
    }
`, `    const cur = sessions.find(s => s.id === activeSessionId);
    if (cur) updateSessionFromChat(cur, chatMessages);
    // 会话数上限规则由 session model 统一维护。
    sessions = pruneSessions(sessions, activeSessionId);
`, 'save history session update/prune');

const forbidden = [
  'function makeSession()',
  'function normalizeMemory(m)',
  'const MAX_MEMORY_TURNS =',
  'const MAX_SESSIONS ='
];
for (const token of forbidden) {
  if (src.includes(token)) throw new Error('Legacy session model token remains: ' + token);
}

fs.writeFileSync(path, src);
console.log('Delegated session/memory model semantics from chat.js');
