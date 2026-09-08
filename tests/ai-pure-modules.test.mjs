import assert from 'node:assert/strict';
import test from 'node:test';

import { countMessagesTokens, trimToBudget, truncateToolDetail } from '../public/modules/ai/conversation/budget.js';
import { formatChatText } from '../public/modules/ai/ui/markdown.js';

function installMinimalDocument() {
  globalThis.document = {
    createElement() {
      let text = '';
      return {
        set textContent(value) { text = String(value ?? ''); },
        get innerHTML() {
          return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }
      };
    }
  };
}

test('conversation budget counts tool-call payloads', () => {
  const plain = [{ role: 'user', content: 'hello' }];
  const withTool = [{ role: 'assistant', content: '', tool_calls: [{ function: { name: 'x', arguments: '{"a":1}' } }] }];
  assert.ok(countMessagesTokens(plain) > 0);
  assert.ok(countMessagesTokens(withTool) > countMessagesTokens([{ role: 'assistant', content: '' }]));
});

test('budget trimming never leaves a tool result orphaned from its assistant tool call', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: '旧'.repeat(200) },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'search_entries', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'result'.repeat(100) },
    { role: 'user', content: '当前任务' }
  ];
  const trimmed = trimToBudget(messages, 10);
  assert.equal(trimmed[0].role, 'system');
  for (let i = 1; i < trimmed.length; i++) {
    if (trimmed[i].role === 'tool') {
      assert.equal(trimmed[i - 1].role, 'assistant');
      assert.ok(trimmed[i - 1].tool_calls);
    }
  }
});

test('tool detail truncation is deterministic and configurable', () => {
  assert.equal(truncateToolDetail('abc', 3), 'abc');
  assert.equal(truncateToolDetail('abcdef', 3), 'abc\n…(结果过长已截断)');
});

test('markdown renderer escapes HTML and rejects javascript links', () => {
  installMinimalDocument();
  const html = formatChatText('<script>alert(1)</script>\n[x](javascript:alert(1))\n[ok](https://example.com)');
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example\.com"/);
});

test('markdown renderer keeps table structure', () => {
  installMinimalDocument();
  const html = formatChatText('| A | B |\n| --- | --- |\n| 1 | 2 |');
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>2<\/td>/);
});
