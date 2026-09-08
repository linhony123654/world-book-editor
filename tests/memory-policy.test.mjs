import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MEMORY_INJECTION_TIGHT,
  ROLLUP_EVERY,
  applyRollup,
  buildMemoryInjection,
  createTurnMemoryRecord,
  needsRollup,
  planRollup
} from '../public/modules/ai/memory/policy.js';

test('turn memory record preserves legacy truncation and skip rules', () => {
  assert.equal(createTurnMemoryRecord({ reply: '(无回复)' }), null);
  assert.equal(createTurnMemoryRecord({ reply: '   ' }), null);

  const record = createTurnMemoryRecord({
    user: 'u'.repeat(250),
    trace: Array.from({ length: 25 }, (_, i) => 't' + i),
    reply: 'r'.repeat(450),
    actionSummary: '修改了设定',
    toolSummary: 'edit_entry',
    now: 123
  });
  assert.equal(record.user.length, 200);
  assert.equal(record.reply.length, 400);
  assert.deepEqual(record.toolDetail, Array.from({ length: 20 }, (_, i) => 't' + (i + 5)));
  assert.equal(record.ts, 123);
});

test('memory injection includes rollups and recent unrolled turns', () => {
  const memory = {
    rollups: [{ text: '建立王城与禁军。' }],
    rolledUpCount: 1,
    turns: [
      { actionSummary: '旧操作', reply: '已归档' },
      { actionSummary: '修改夜禁', reply: '改为戌时开始' },
      { toolSummary: 'search_entries', reply: '找到禁军条目' }
    ]
  };
  const text = buildMemoryInjection(memory);
  assert.match(text, /长期记忆 · 阶段总结/);
  assert.match(text, /建立王城与禁军/);
  assert.doesNotMatch(text, /旧操作/);
  assert.match(text, /1\. 修改夜禁 → 改为戌时开始/);
  assert.match(text, /2\. 完成了相关查询或修改 → 找到禁军条目/);
});

test('memory injection keeps newest detailed lines and respects outer cap', () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({
    actionSummary: '操作' + i + '-' + 'x'.repeat(400),
    reply: '结果' + i
  }));
  const memory = { rollups: [], rolledUpCount: 0, turns };
  const text = buildMemoryInjection(memory, MEMORY_INJECTION_TIGHT);
  assert.match(text, /记忆注入已截断/);
  assert.ok(text.length <= MEMORY_INJECTION_TIGHT + 20);
});

test('rollup planning starts at rolledUpCount and uses exactly one batch', () => {
  const memory = {
    rolledUpCount: 2,
    rollups: [{ from: 0, to: 2, text: '旧摘要' }],
    turns: Array.from({ length: 12 }, (_, i) => ({
      user: '用户' + i,
      actionSummary: i % 2 ? '修改条目' + i : '',
      toolSummary: i % 2 ? 'edit_entry' : 'search_entries',
      reply: '结果' + i
    }))
  };
  assert.equal(needsRollup(memory, ROLLUP_EVERY), true);
  const plan = planRollup(memory);
  assert.equal(plan.from, 2);
  assert.equal(plan.to, 12);
  assert.equal(plan.batch.length, 10);
  assert.match(plan.messages[1].content, /已有阶段总结/);
  assert.match(plan.messages[1].content, /旧摘要/);
  assert.match(plan.messages[1].content, /需要整合的 10 个回合/);
});

test('applying a rollup advances only after non-empty completion', () => {
  const memory = { turns: Array.from({ length: 10 }, () => ({})), rollups: [], rolledUpCount: 0 };
  const plan = planRollup(memory);
  assert.equal(applyRollup(memory, plan, '   '), false);
  assert.equal(memory.rolledUpCount, 0);
  assert.equal(applyRollup(memory, plan, '阶段摘要'), true);
  assert.equal(memory.rolledUpCount, 10);
  assert.deepEqual(memory.rollups, [{ from: 0, to: 10, text: '阶段摘要' }]);
});
