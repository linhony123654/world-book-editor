import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChangeLabel,
  buildChatMessageMarkup,
  buildToolTraceLineMarkup,
  chatRoleLabel,
  parseToolTraceLine,
  shouldScrollAfterMessage
} from '../public/modules/ai/ui/chat-renderer.js';

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

installMinimalDocument();

test('role labels preserve the existing Chinese chat labels and unknown fallback', () => {
  assert.equal(chatRoleLabel('user'), '你');
  assert.equal(chatRoleLabel('assistant'), 'AI');
  assert.equal(chatRoleLabel('tool'), '工具');
  assert.equal(chatRoleLabel('error'), '错误');
  assert.equal(chatRoleLabel('system'), 'system');
});

test('message markup preserves classes and escapes untrusted text', () => {
  const html = buildChatMessageMarkup('user', '<img src=x onerror=alert(1)>');
  assert.match(html, /chat-msg-role">你/);
  assert.match(html, /chat-msg-text/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/i);
});

test('tool trace parsing splits only the first colon-space boundary', () => {
  assert.deepEqual(parseToolTraceLine('search_entries: 找到 2 条: 王城'), {
    name: 'search_entries',
    summary: '找到 2 条: 王城'
  });
  assert.deepEqual(parseToolTraceLine('undo_last'), { name: 'undo_last', summary: '' });
});

test('tool trace markup escapes tool names and summaries', () => {
  const html = buildToolTraceLineMarkup('<tool>: <b>done</b>');
  assert.match(html, /&lt;tool&gt;/);
  assert.match(html, /&lt;b&gt;done&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>done<\/b>/);
});

test('change labels preserve icon, comment, detail and unknown-type fallback', () => {
  assert.equal(
    buildChangeLabel({ type: 'edit', tool: 'edit_entry', comment: '王城', detail: '更新正文' }),
    '✎ edit_entry「王城」 — 更新正文'
  );
  assert.equal(buildChangeLabel({ type: 'delete', tool: 'delete_entry' }), '✕ delete_entry');
  assert.equal(buildChangeLabel({ type: 'unexpected', tool: 'x' }), '· x');
});

test('user/error messages force scrolling while assistant follows near-bottom state', () => {
  assert.equal(shouldScrollAfterMessage('user', false), true);
  assert.equal(shouldScrollAfterMessage('error', false), true);
  assert.equal(shouldScrollAfterMessage('assistant', false), false);
  assert.equal(shouldScrollAfterMessage('assistant', true), true);
});
