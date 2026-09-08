import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addSessionTokens,
  createSession,
  emptyMemory,
  enforceMemoryLimits,
  normalizeMemory,
  normalizeSessionList,
  pruneSessions,
  recentMemoryTurns,
  selectActiveSession,
  titleFromMessages,
  updateSessionFromChat,
  visibleMessagesFromSession
} from '../public/modules/ai/session/model.js';

test('createSession preserves legacy shape and deterministic id format', () => {
  const session = createSession({ now: 1000, random: 0.123456 });
  assert.equal(session.id, 'srs4fzyo');
  assert.equal(session.title, '新对话');
  assert.deepEqual(session.messages, []);
  assert.deepEqual(session.memory, emptyMemory());
  assert.equal(session.tokensTotal, 0);
  assert.equal(session.createdAt, 1000);
  assert.equal(session.updatedAt, 1000);
});

test('titleFromMessages uses first user text, collapses whitespace and truncates at 14 chars', () => {
  assert.equal(titleFromMessages([{ role: 'assistant', content: 'x' }]), '新对话');
  assert.equal(titleFromMessages([{ role: 'user', content: '  王城   夜禁  ' }]), '王城 夜禁');
  assert.equal(titleFromMessages([{ role: 'user', content: '123456789012345678' }]), '12345678901234…');
});

test('loaded sessions ignore malformed records and active selection falls back to newest list item', () => {
  const list = normalizeSessionList([
    null,
    { id: 'bad' },
    { id: 'a', messages: [] },
    { id: 'b', messages: [{ role: 'user', content: 'b' }] }
  ]);
  assert.deepEqual(list.map(session => session.id), ['a', 'b']);
  assert.equal(selectActiveSession(list, 'a').id, 'a');
  assert.equal(selectActiveSession(list, 'missing').id, 'b');
});

test('visibleMessagesFromSession strips protocol/tool records and non-string content', () => {
  const visible = visibleMessagesFromSession({ messages: [
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' },
    { role: 'assistant', content: 'a', tokens: 9 },
    { role: 'tool', content: 't' },
    { role: 'assistant', content: null }
  ] });
  assert.deepEqual(visible, [
    { role: 'user', content: 'u' },
    { role: 'assistant', content: 'a' }
  ]);
});

test('updateSessionFromChat preserves AI title and otherwise derives fallback title', () => {
  const chat = [{ role: 'user', content: '第一个用户问题' }];
  const fallback = { id: 'a', title: '新对话', aiTitled: false, messages: [] };
  updateSessionFromChat(fallback, chat, { now: 50 });
  assert.equal(fallback.title, '第一个用户问题');
  assert.equal(fallback.updatedAt, 50);
  assert.notEqual(fallback.messages, chat);

  const ai = { id: 'b', title: 'AI 标题', aiTitled: true, messages: [] };
  updateSessionFromChat(ai, chat, { now: 60 });
  assert.equal(ai.title, 'AI 标题');
});

test('pruneSessions keeps active first and newest non-active sessions within limit', () => {
  const sessions = [
    { id: 'old', updatedAt: 1 },
    { id: 'active', updatedAt: 2 },
    { id: 'new', updatedAt: 9 },
    { id: 'mid', updatedAt: 5 }
  ];
  assert.deepEqual(pruneSessions(sessions, 'active', 3).map(s => s.id), ['active', 'new', 'mid']);
  assert.deepEqual(pruneSessions(sessions, 'missing', 2).map(s => s.id), ['new', 'mid']);
});

test('memory normalization and limits preserve rolled-up prefix semantics', () => {
  const normalized = normalizeMemory({ turns: [{ id: 1 }], rolledUpCount: 1 });
  assert.deepEqual(normalized.rollups, []);
  assert.equal(recentMemoryTurns(normalized).length, 0);

  const memory = {
    turns: Array.from({ length: 6 }, (_, i) => ({ i })),
    rollups: [{ n: 1 }, { n: 2 }, { n: 3 }],
    rolledUpCount: 3
  };
  enforceMemoryLimits(memory, { maxTurns: 4, maxRollups: 2 });
  assert.deepEqual(memory.turns.map(turn => turn.i), [2, 3, 4, 5]);
  assert.equal(memory.rolledUpCount, 1);
  assert.deepEqual(memory.rollups.map(r => r.n), [2, 3]);
});

test('token accumulation keeps existing total and tolerates empty token values', () => {
  const session = { tokensTotal: 10 };
  assert.equal(addSessionTokens(session, 5), 15);
  assert.equal(addSessionTokens(session, 0), 15);
});
