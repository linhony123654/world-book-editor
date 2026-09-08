import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAssistantStreamMarkup,
  createAssistantStreamView
} from '../public/modules/ai/ui/assistant-stream-view.js';

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

test('stream markup renders typing, reasoning-open state, and escaped markdown', () => {
  assert.equal(buildAssistantStreamMarkup('', '', false), '<span class="typing-cursor">◊</span>');

  const streaming = buildAssistantStreamMarkup('**answer**', '<think>', true);
  assert.match(streaming, /<details class="reasoning-box" open>/);
  assert.match(streaming, /<div class="stream-content"><p class="md-p"><strong>answer<\/strong><\/p><\/div>/);
  assert.match(streaming, /&lt;think&gt;/);

  const final = buildAssistantStreamMarkup('done', 'reason', false);
  assert.match(final, /<details class="reasoning-box">/);
  assert.doesNotMatch(final, /reasoning-box" open/);
});

test('view rebuilds missing structure synchronously for non-streaming renders', () => {
  const host = {
    innerHTML: '',
    querySelector() { return null; }
  };
  const view = createAssistantStreamView({ requestFrame: null, cancelFrame: null });
  view.render(host, 'hello', '', false);
  assert.match(host.innerHTML, /stream-content/);
  assert.match(host.innerHTML, /hello/);
});

test('view incrementally updates existing content and reasoning nodes', () => {
  const text = { innerHTML: '' };
  const reasoningText = { innerHTML: '' };
  const reasoningBox = {
    open: true,
    querySelector(selector) { return selector === '.reasoning-text' ? reasoningText : null; }
  };
  const host = {
    querySelector(selector) {
      if (selector === '.stream-content') return text;
      if (selector === '.reasoning-box') return reasoningBox;
      return null;
    }
  };
  const view = createAssistantStreamView({ requestFrame: null, cancelFrame: null });
  view.render(host, '**next**', 'why', false);
  assert.equal(text.innerHTML, '<p class="md-p"><strong>next</strong></p>');
  assert.equal(reasoningText.innerHTML, '<p class="md-p">why</p>');
});

test('streaming renders coalesce through requestAnimationFrame and cancel stale frames', () => {
  const scheduled = [];
  const cancelled = [];
  let id = 0;
  const host = {
    innerHTML: '',
    querySelector() { return null; }
  };
  const view = createAssistantStreamView({
    requestFrame: callback => { scheduled.push({ id: ++id, callback }); return id; },
    cancelFrame: frameId => cancelled.push(frameId)
  });

  view.render(host, 'first', 'r', true);
  view.render(host, 'second', 'r', true);
  assert.deepEqual(cancelled, [1]);
  assert.equal(scheduled.length, 2);

  scheduled[1].callback();
  assert.match(host.innerHTML, /second/);
  assert.doesNotMatch(host.innerHTML, />first</);
});

test('final synchronous render cancels any queued streaming frame', () => {
  const cancelled = [];
  const host = { innerHTML: '', querySelector() { return null; } };
  const view = createAssistantStreamView({
    requestFrame: () => 17,
    cancelFrame: id => cancelled.push(id)
  });
  view.render(host, 'queued', 'r', true);
  view.render(host, 'final', 'r', false);
  assert.deepEqual(cancelled, [17]);
  assert.match(host.innerHTML, /final/);
});

test('collapse closes reasoning details only when reasoning is non-empty', () => {
  const box = { open: true };
  const host = { querySelector: selector => selector === '.reasoning-box' ? box : null };
  const view = createAssistantStreamView({ requestFrame: null, cancelFrame: null });

  assert.equal(view.collapse(host, ''), false);
  assert.equal(box.open, true);
  assert.equal(view.collapse(host, 'reason'), true);
  assert.equal(box.open, false);
});
