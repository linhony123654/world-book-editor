import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyComposerBusyState,
  chatInputHeight,
  createChatComposer,
  isChatSendKey,
  resizeChatInput
} from '../public/modules/ai/ui/chat-composer.js';

function fakeElement() {
  const listeners = new Map();
  const classes = new Set();
  return {
    listeners,
    disabled: true,
    style: {},
    scrollHeight: 0,
    attrs: {},
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    fire(type, event = {}) { listeners.get(type)?.(event); }
  };
}

test('Enter without Shift is send; Shift+Enter remains multiline', () => {
  assert.equal(isChatSendKey({ key: 'Enter', shiftKey: false }), true);
  assert.equal(isChatSendKey({ key: 'Enter', shiftKey: true }), false);
  assert.equal(isChatSendKey({ key: 'a', shiftKey: false }), false);
});

test('input height is clamped to the existing 120px maximum', () => {
  assert.equal(chatInputHeight(80), 80);
  assert.equal(chatInputHeight(180), 120);
  assert.equal(chatInputHeight(-10), 0);
  const input = fakeElement();
  input.scrollHeight = 146;
  assert.equal(resizeChatInput(input), 120);
  assert.equal(input.style.height, '120px');
});

test('busy state keeps send button clickable and switches labels/classes', () => {
  const button = fakeElement();
  const input = fakeElement();
  applyComposerBusyState(button, input, true);
  assert.equal(button.disabled, false);
  assert.equal(button.attrs['aria-label'], '停止生成');
  assert.equal(button.classList.contains('is-busy'), true);
  assert.equal(input.classList.contains('sending'), true);

  applyComposerBusyState(button, input, false);
  assert.equal(button.attrs['aria-label'], '发送');
  assert.equal(button.classList.contains('is-busy'), false);
  assert.equal(input.classList.contains('sending'), false);
});

test('button click sends when idle and stops when generation is active', () => {
  const button = fakeElement();
  let sending = false;
  let sends = 0;
  let stops = 0;
  const composer = createChatComposer({
    sendButton: button,
    getIsSending: () => sending,
    onSend: () => sends++,
    onStop: () => stops++
  });
  composer.bind();

  button.fire('click');
  sending = true;
  button.fire('click');
  assert.equal(sends, 1);
  assert.equal(stops, 1);
});

test('Enter always delegates to send callback; busy guarding remains in sendChat', () => {
  const input = fakeElement();
  let prevented = 0;
  let sends = 0;
  const composer = createChatComposer({ input, onSend: () => sends++ });
  composer.bind();

  input.fire('keydown', { key: 'Enter', shiftKey: false, preventDefault: () => prevented++ });
  input.fire('keydown', { key: 'Enter', shiftKey: true, preventDefault: () => prevented++ });
  assert.equal(sends, 1);
  assert.equal(prevented, 1);
});

test('scroll and to-bottom controls preserve their separate callbacks', () => {
  const scroller = fakeElement();
  const toBottom = fakeElement();
  let scrolls = 0;
  let bottoms = 0;
  const composer = createChatComposer({
    scroller,
    toBottomButton: toBottom,
    onScroll: () => scrolls++,
    onToBottom: () => bottoms++
  });
  composer.bind();
  scroller.fire('scroll');
  toBottom.fire('click');
  assert.equal(scrolls, 1);
  assert.equal(bottoms, 1);
});
