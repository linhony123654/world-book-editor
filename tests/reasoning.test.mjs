import assert from 'node:assert/strict';
import test from 'node:test';

import { extractReasoningDelta, hasVisibleAssistantStream, reasoningDetailsShouldBeOpen, shouldCollapseReasoningAfterStream } from '../public/modules/reasoning.js';

test('extracts DeepSeek reasoning_content delta', () => {
  assert.equal(extractReasoningDelta({ reasoning_content: '先分析需求' }), '先分析需求');
});

test('extracts compatible reasoning string delta', () => {
  assert.equal(extractReasoningDelta({ reasoning: '继续判断类型' }), '继续判断类型');
});

test('extracts compatible reasoning object content', () => {
  assert.equal(extractReasoningDelta({ reasoning: { content: '检查关键词' } }), '检查关键词');
});

test('returns empty string when no explicit reasoning field exists', () => {
  assert.equal(extractReasoningDelta({ content: '最终回复' }), '');
});

test('keeps assistant stream visible when a tool round only has reasoning', () => {
  assert.equal(hasVisibleAssistantStream('', '这里是工具调用前的思考'), true);
  assert.equal(hasVisibleAssistantStream('最终回复', ''), true);
  assert.equal(hasVisibleAssistantStream('让我先看看当前世界书。', '先读取条目列表。'), true);
  assert.equal(hasVisibleAssistantStream('', ''), false);
});

test('collapses reasoning after streaming only when reasoning exists', () => {
  assert.equal(shouldCollapseReasoningAfterStream('思考内容'), true);
  assert.equal(shouldCollapseReasoningAfterStream(''), false);
});

test('opens reasoning while streaming and keeps it closed after post-processing render', () => {
  assert.equal(reasoningDetailsShouldBeOpen('思考内容', true), true);
  assert.equal(reasoningDetailsShouldBeOpen('思考内容', false), false);
  assert.equal(reasoningDetailsShouldBeOpen('', true), false);
});
