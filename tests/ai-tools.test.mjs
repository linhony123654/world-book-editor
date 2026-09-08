import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_NAMES } from '../public/modules/tool-names.js';
import { getTools } from '../public/modules/ai/tools/definitions.js';
import { hasToolCall, parseTextToolCalls, stripToolCalls } from '../public/modules/ai/tools/text-tool-parser.js';

test('tool definitions and canonical tool-name registry stay in sync', () => {
  const names = getTools().map(tool => tool.function.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual([...names].sort(), [...TOOL_NAMES].sort());
});

test('text fallback parser handles tool_use JSON', () => {
  const text = '<tool_use>{"name":"search_entries","arguments":{"query":"王城"}}</tool_use>';
  assert.equal(hasToolCall(text), true);
  assert.deepEqual(parseTextToolCalls(text), [{ name: 'search_entries', args: { query: '王城' } }]);
});

test('text fallback parser preserves structured function parameters', () => {
  const text = '<function=delete_entries><parameter=uids>[1,2,3]</parameter><parameter=filter>{"disable":true}</parameter></function>';
  assert.deepEqual(parseTextToolCalls(text), [{
    name: 'delete_entries',
    args: { uids: [1, 2, 3], filter: { disable: true } }
  }]);
});

test('text fallback parser handles compact function syntax', () => {
  assert.deepEqual(parseTextToolCalls('search_entries("夜禁")'), [{
    name: 'search_entries', args: { query: '夜禁' }
  }]);
});

test('stripToolCalls keeps user-visible prose while removing tool payloads', () => {
  const input = '先查询。\n<tool_use>{"name":"search_entries","arguments":{"query":"王城"}}</tool_use>\n\n然后继续。';
  assert.equal(stripToolCalls(input), '先查询。\n\n然后继续。');
});
