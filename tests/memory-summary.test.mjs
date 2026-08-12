import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeToolTraceForMemory, containsToolCallSyntax } from '../modules/memory-summary.js';

test('summarizes tool operations as natural language without tool call syntax', () => {
  const summary = summarizeToolTraceForMemory([
    'search_entries: 找到 3 条',
    'edit_entry: 已修改 #12 的 content',
    'manage_keys: #12 关键词 +1 / -0',
    '<tool_call><function=delete_entry><parameter=uid>7</parameter></function></tool_call>',
    '{"name":"add_entry","arguments":{"content":"测试"}}',
    'search_entries("王城")'
  ]);

  assert.match(summary, /完成了 6 项操作/);
  assert.doesNotMatch(summary, /search_entries|edit_entry|manage_keys|delete_entry|add_entry/);
  assert.equal(containsToolCallSyntax(summary), false);
});

test('detects common textual tool call formats', () => {
  assert.equal(containsToolCallSyntax('<tool_call><function=search_entries></function></tool_call>'), true);
  assert.equal(containsToolCallSyntax('{"name":"edit_entry","arguments":{"uid":1}}'), true);
  assert.equal(containsToolCallSyntax('search_entries("关键词")'), true);
  assert.equal(containsToolCallSyntax('已查找相关条目并完成修改。'), false);
});
