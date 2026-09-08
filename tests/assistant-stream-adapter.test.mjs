import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compactToolCalls,
  consumeAssistantStream,
  mergeToolCallDelta
} from '../public/modules/ai/conversation/stream-adapter.js';

async function* chunks(items) {
  for (const item of items) yield item;
}

function delta(value) {
  return { choices: [{ delta: value }] };
}

test('mergeToolCallDelta concatenates fragmented names/arguments and preserves sparse indexes', () => {
  const calls = [];
  mergeToolCallDelta(calls, [
    { index: 1, id: 'call-1', function: { name: 'edit_', arguments: '{"uid":' } }
  ]);
  mergeToolCallDelta(calls, [
    { index: 1, function: { name: 'entry', arguments: '7}' } },
    { index: 3, id: 'call-3', function: { name: 'list_entries', arguments: '{}' } }
  ]);

  assert.equal(calls[0], undefined);
  assert.equal(calls[1].id, 'call-1');
  assert.equal(calls[1].function.name, 'edit_entry');
  assert.equal(calls[1].function.arguments, '{"uid":7}');
  assert.equal(calls[3].function.name, 'list_entries');
});

test('compactToolCalls drops sparse holes and nameless fragments', () => {
  const calls = [];
  calls[0] = { id: 'blank', function: { name: '', arguments: '{}' } };
  calls[2] = { id: 'ok', function: { name: 'search_entries', arguments: '{}' } };
  assert.deepEqual(compactToolCalls(calls), [calls[2]]);
});

test('consumeAssistantStream aggregates content/reasoning and emits legacy update order', async () => {
  const updates = [];
  const completes = [];
  const result = await consumeAssistantStream(chunks([
    delta({ reasoning_content: 'think-1', content: 'hello ' }),
    { choices: [] },
    delta({ reasoning_content: 'think-2' }),
    delta({ content: 'world' })
  ]), {
    extractReasoning: d => d.reasoning_content || '',
    onUpdate: state => updates.push({ ...state }),
    onComplete: state => completes.push({ ...state })
  });

  assert.deepEqual(updates.map(u => u.kind), ['reasoning', 'content', 'reasoning', 'content']);
  assert.equal(updates[0].content, '');
  assert.equal(updates[1].content, 'hello ');
  assert.equal(result.content, 'hello world');
  assert.equal(result.reasoning, 'think-1think-2');
  assert.equal(result.tool_calls, null);
  assert.deepEqual(completes, [{ content: 'hello world', reasoning: 'think-1think-2' }]);
});

test('consumeAssistantStream reconstructs tool calls from Anthropic-style sparse OpenAI indexes', async () => {
  const result = await consumeAssistantStream(chunks([
    delta({ tool_calls: [{ index: 1, id: 'c1', function: { name: 'add_', arguments: '{"comment":"A"' } }] }),
    delta({ tool_calls: [{ index: 1, function: { name: 'entry', arguments: '}' } }] }),
    delta({ tool_calls: [{ index: 0, id: 'text-block', function: { name: '', arguments: '' } }] })
  ]));

  assert.deepEqual(result.tool_calls, [{
    id: 'c1',
    type: 'function',
    function: { name: 'add_entry', arguments: '{"comment":"A"}' }
  }]);
});

test('onComplete runs after the async iterable is exhausted and may itself be async', async () => {
  const order = [];
  await consumeAssistantStream(chunks([
    delta({ content: 'x' })
  ]), {
    onUpdate: async () => { order.push('update'); },
    onComplete: async () => { order.push('complete'); }
  });
  assert.deepEqual(order, ['update', 'complete']);
});
