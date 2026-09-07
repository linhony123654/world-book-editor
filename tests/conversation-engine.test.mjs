import assert from 'node:assert/strict';
import test from 'node:test';

import { runConversationTurn } from '../public/modules/ai/conversation/engine.js';

function nativeCall(name, args, id = '') {
  return {
    content: '',
    reasoning: '',
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
  };
}

test('native tool round preserves assistant/tool pairing then returns final reply', async () => {
  const messages = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
  let round = 0;
  const seen = [];
  const outcome = await runConversationTurn({
    messages,
    makeToolCallId: () => 'call_test',
    requestRound: async () => round++ === 0
      ? { result: nativeCall('search_entries', { query: '王城' }) }
      : { result: { content: '完成', reasoning: 'ok', tool_calls: null }, context: 'bubble-2' },
    executeTool: async (name, args) => ({ summary: '找到 1 条', detail: name + ':' + args.query }),
    onToolResult: async event => seen.push(event.name + ':' + event.result.summary)
  });

  assert.equal(outcome.status, 'final');
  assert.equal(outcome.content, '完成');
  assert.deepEqual(outcome.turnTrace, ['search_entries: 找到 1 条']);
  assert.deepEqual(seen, ['search_entries:找到 1 条']);

  const assistant = messages.find(m => m.role === 'assistant' && m.tool_calls);
  const tool = messages.find(m => m.role === 'tool');
  assert.equal(assistant.tool_calls[0].id, 'call_test');
  assert.equal(tool.tool_call_id, 'call_test');
});

test('malformed native arguments become a tool error without invoking executor', async () => {
  const messages = [{ role: 'system', content: 's' }];
  let round = 0;
  let executed = false;
  const events = [];
  const outcome = await runConversationTurn({
    messages,
    makeToolCallId: () => 'bad_call',
    requestRound: async () => {
      if (round++ === 0) return { result: { content: '', tool_calls: [{ type: 'function', function: { name: 'edit_entry', arguments: '{bad' } }] } };
      return { result: { content: '参数已修正', tool_calls: null } };
    },
    executeTool: async () => { executed = true; return { summary: 'x', detail: 'x' }; },
    onToolResult: async event => events.push(event)
  });

  assert.equal(executed, false);
  assert.equal(outcome.status, 'final');
  assert.match(messages.find(m => m.role === 'tool').content, /JSON 解析失败/);
  assert.equal(events[0].parseError, true);
  assert.deepEqual(outcome.turnTrace, ['edit_entry: 参数解析失败']);
});

test('textual fallback adds synthetic tool-result user message and continues', async () => {
  const messages = [{ role: 'system', content: 's' }];
  let round = 0;
  const outcome = await runConversationTurn({
    messages,
    requestRound: async () => round++ === 0
      ? { result: { content: '<tool_use>{"name":"search_entries","arguments":{"query":"夜禁"}}</tool_use>' } }
      : { result: { content: '已查到夜禁设定' } },
    executeTool: async () => ({ summary: '找到 2 条', detail: '#1\n#2' })
  });

  assert.equal(outcome.status, 'final');
  assert.equal(outcome.content, '已查到夜禁设定');
  assert.ok(messages.some(m => m.role === 'user' && /工具执行结果/.test(m.content)));
  assert.deepEqual(outcome.turnTrace, ['search_entries: 找到 2 条']);
});

test('preview tool stops the loop and returns the triggering call', async () => {
  const messages = [{ role: 'system', content: 's' }];
  let requests = 0;
  const outcome = await runConversationTurn({
    messages,
    requestRound: async () => {
      requests++;
      return { result: nativeCall('plan_smart_entry', { title: '银塔' }, 'p1') };
    },
    executeTool: async () => ({ summary: '已生成预览', detail: 'preview', stop: true })
  });

  assert.equal(outcome.status, 'preview-stop');
  assert.equal(outcome.previewCall.name, 'plan_smart_entry');
  assert.equal(outcome.previewCall.args.title, '银塔');
  assert.equal(requests, 1);
});

test('change metadata is aggregated with originating tool name', async () => {
  const messages = [{ role: 'system', content: 's' }];
  let round = 0;
  const outcome = await runConversationTurn({
    messages,
    requestRound: async () => round++ === 0
      ? { result: nativeCall('edit_entry', { uid: 1 }, 'e1') }
      : { result: { content: '完成' } },
    executeTool: async () => ({ summary: '已修改', detail: 'ok', changes: [{ type: 'edit', uid: 1 }] })
  });

  assert.deepEqual(outcome.turnChanges, [{ tool: 'edit_entry', type: 'edit', uid: 1 }]);
});

test('max-rounds returns accumulated trace instead of inventing a final reply', async () => {
  const messages = [{ role: 'system', content: 's' }];
  let id = 0;
  const outcome = await runConversationTurn({
    messages,
    maxRounds: 2,
    requestRound: async () => ({ result: nativeCall('search_entries', { query: 'x' }, 'c' + (++id)) }),
    executeTool: async () => ({ summary: 'ok', detail: 'ok' })
  });

  assert.equal(outcome.status, 'max-rounds');
  assert.equal(outcome.rounds, 2);
  assert.deepEqual(outcome.turnTrace, ['search_entries: ok', 'search_entries: ok']);
});
