import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateTokens } from '../public/modules/utils.js';

test('estimateTokens: 空/非字符串返回 0', () => {
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
  assert.equal(estimateTokens(''), 0);
});

test('estimateTokens: 中文按 ~0.8 token/字 估算', () => {
  // 10 个汉字 ≈ 8 token
  assert.equal(estimateTokens('一二三四五六七八九十'), 8);
  // 100 个汉字 ≈ 80 token
  assert.equal(estimateTokens('字'.repeat(100)), 80);
});

test('estimateTokens: 英文按 ~0.3 token/字符 估算', () => {
  // 10 个 ASCII ≈ 3 token
  assert.equal(estimateTokens('abcdefghij'), 3);
});

test('estimateTokens: 混合内容', () => {
  const mixed = '世界书' + 'hello';
  // 3 汉字 ×0.8 = 2.4；5 ASCII ×0.3 = 1.5；合计 3.9 → ceil = 4
  assert.equal(estimateTokens(mixed), 4);
});
