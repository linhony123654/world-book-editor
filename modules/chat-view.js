export const CHAT_VISIBLE_LIMIT_KEY = 'wbe-chat-visible-limit';
export const DEFAULT_CHAT_VISIBLE_LIMIT = 10;
export const MAX_CHAT_VISIBLE_LIMIT = 200;

export function normalizeChatVisibleLimit(value) {
  if (value == null || value === '') return DEFAULT_CHAT_VISIBLE_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_CHAT_VISIBLE_LIMIT;
  if (n > MAX_CHAT_VISIBLE_LIMIT) return MAX_CHAT_VISIBLE_LIMIT;
  return n;
}

export function readChatVisibleLimit(storage) {
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  return normalizeChatVisibleLimit(s ? s.getItem(CHAT_VISIBLE_LIMIT_KEY) : null);
}

export function saveChatVisibleLimit(value, storage) {
  const limit = normalizeChatVisibleLimit(value);
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (s) s.setItem(CHAT_VISIBLE_LIMIT_KEY, String(limit));
  return limit;
}

export function visibleChatStartIndex(total, limit) {
  if (!limit) return 0;
  return Math.max(0, total - limit);
}

export function applyVisibleLimitToChildren(children, limit) {
  const start = visibleChatStartIndex(children.length, limit);
  children.forEach((child, index) => {
    child.hidden = index < start;
  });
  return start;
}
