export const MAX_SESSIONS = 20;
export const MAX_MEMORY_TURNS = 100;
export const MAX_MEMORY_ROLLUPS = 10;

export function emptyMemory() {
  return { turns: [], rollups: [], rolledUpCount: 0 };
}

// Preserve the legacy tolerance for incomplete/older memory payloads.
export function normalizeMemory(memory) {
  return {
    turns: (memory && memory.turns) || [],
    rollups: (memory && memory.rollups) || [],
    rolledUpCount: (memory && memory.rolledUpCount) || 0
  };
}

export function createSession({ now = Date.now(), random = Math.random() } = {}) {
  return {
    id: 's' + Number(now).toString(36) + Number(random).toString(36).slice(2, 7),
    title: '新对话',
    messages: [],
    createdAt: Number(now),
    updatedAt: Number(now),
    aiTitled: false,
    memory: emptyMemory(),
    tokensTotal: 0
  };
}

export function titleFromMessages(messages) {
  const first = (messages || []).find(message => message && message.role === 'user');
  if (!first) return '新对话';
  const text = String(first.content || '').replace(/\s+/g, ' ').trim();
  return text.length > 14 ? text.slice(0, 14) + '…' : (text || '新对话');
}

export function normalizeSessionList(value) {
  return (Array.isArray(value) ? value : []).filter(session => session && Array.isArray(session.messages));
}

export function selectActiveSession(sessions, activeId) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list.find(session => session.id === activeId) || list[list.length - 1] || null;
}

// Only user/assistant text is restored into the visible conversation history.
// Tool protocol messages are intentionally not persisted into chatMessages.
export function visibleMessagesFromSession(session) {
  if (!session || !Array.isArray(session.messages)) return [];
  return session.messages
    .filter(message => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .map(message => ({ role: message.role, content: message.content }));
}

export function updateSessionFromChat(session, chatMessages, { now = Date.now() } = {}) {
  if (!session) return session;
  session.messages = (chatMessages || []).slice();
  session.updatedAt = Number(now);
  if (!session.aiTitled && (!session.title || session.title === '新对话')) {
    session.title = titleFromMessages(chatMessages || []);
  }
  return session;
}

// Preserve legacy pruning order exactly: active session first, followed by the
// most recently updated non-active sessions. This intentionally does not sort
// the active item together with the rest.
export function pruneSessions(sessions, activeSessionId, limit = MAX_SESSIONS) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (list.length <= limit) return list.slice();
  const active = list.find(session => session.id === activeSessionId);
  const others = list
    .filter(session => session.id !== activeSessionId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit - (active ? 1 : 0));
  return active ? [active, ...others] : others;
}

export function addSessionTokens(session, tokens) {
  if (!session) return 0;
  session.tokensTotal = (session.tokensTotal || 0) + (tokens || 0);
  return session.tokensTotal;
}

// Mutates the supplied memory object to preserve existing reference semantics
// used by chat.js and session.memory.
export function enforceMemoryLimits(memory, {
  maxTurns = MAX_MEMORY_TURNS,
  maxRollups = MAX_MEMORY_ROLLUPS
} = {}) {
  const value = memory || emptyMemory();
  if (!Array.isArray(value.turns)) value.turns = [];
  if (!Array.isArray(value.rollups)) value.rollups = [];
  if (!Number.isFinite(value.rolledUpCount)) value.rolledUpCount = 0;

  if (value.turns.length > maxTurns) {
    const excess = value.turns.length - maxTurns;
    const dropFromRolled = Math.min(excess, value.rolledUpCount);
    if (dropFromRolled > 0) {
      value.turns.splice(0, dropFromRolled);
      value.rolledUpCount -= dropFromRolled;
    }
    if (value.turns.length > maxTurns) {
      value.turns.splice(0, value.turns.length - maxTurns);
      if (value.rolledUpCount > value.turns.length) value.rolledUpCount = value.turns.length;
    }
  }
  if (value.rollups.length > maxRollups) value.rollups = value.rollups.slice(-maxRollups);
  return value;
}

export function recentMemoryTurns(memory) {
  const value = normalizeMemory(memory);
  return value.turns.slice(value.rolledUpCount);
}
