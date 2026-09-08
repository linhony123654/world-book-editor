import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMessageEditView,
  normalizedMessageEditValue,
  resolveMessageHost,
  resolveMessageTextElement
} from '../public/modules/ai/ui/message-edit-view.js';

function element(tag = 'div') {
  const listeners = new Map();
  const classes = new Set();
  return {
    tag,
    className: '',
    textContent: '',
    value: '',
    innerHTML: '',
    parentElement: null,
    children: [],
    focused: false,
    classList: {
      contains(name) { return classes.has(name); },
      add(name) { classes.add(name); }
    },
    appendChild(child) { this.children.push(child); child.parentElement = this; },
    addEventListener(type, handler) { listeners.set(type, handler); },
    fire(type) { listeners.get(type)?.(); },
    focus() { this.focused = true; },
    querySelector(selector) {
      if (selector === '.chat-msg-text') return this.children.find(c => c.className === 'chat-msg-text') || null;
      return null;
    }
  };
}

function fakeDocument() {
  return { createElement: tag => element(tag) };
}

test('host/text resolution supports outer bubble and inner text node', () => {
  const host = element();
  const text = element();
  text.className = 'chat-msg-text';
  host.appendChild(text);
  text.classList.add('chat-msg-text');

  assert.equal(resolveMessageHost(text), host);
  assert.equal(resolveMessageHost(host), host);
  assert.equal(resolveMessageTextElement(text), text);
  assert.equal(resolveMessageTextElement(host), text);
});

test('edit values preserve internal whitespace but trim boundaries', () => {
  assert.equal(normalizedMessageEditValue('  hello\nworld  '), 'hello\nworld');
  assert.equal(normalizedMessageEditValue('   '), '');
});

test('start builds textarea/actions and saves trimmed value', () => {
  const host = element();
  const text = element();
  text.className = 'chat-msg-text';
  host.appendChild(text);
  const saved = [];
  const view = createMessageEditView({
    documentRef: fakeDocument(),
    onSave: (index, value) => saved.push([index, value])
  });

  const state = view.start(host, 3, ' original ');
  assert.ok(state);
  assert.equal(host.classList.contains('chat-msg-editing'), true);
  assert.equal(state.textarea.value, ' original ');
  assert.equal(state.textarea.focused, true);
  state.textarea.value = '  updated  ';
  state.saveBtn.fire('click');
  assert.deepEqual(saved, [[3, 'updated']]);
});

test('blank save calls onEmpty and does not call onSave', () => {
  const host = element();
  const text = element();
  text.className = 'chat-msg-text';
  host.appendChild(text);
  let empty = 0;
  let saved = 0;
  const view = createMessageEditView({
    documentRef: fakeDocument(),
    onEmpty: () => empty++,
    onSave: () => saved++
  });
  const state = view.start(host, 1, 'x');
  state.textarea.value = '   ';
  state.saveBtn.fire('click');
  assert.equal(empty, 1);
  assert.equal(saved, 0);
});

test('cancel delegates without mutating data and duplicate edit is ignored', () => {
  const host = element();
  const text = element();
  text.className = 'chat-msg-text';
  host.appendChild(text);
  let cancels = 0;
  const view = createMessageEditView({ documentRef: fakeDocument(), onCancel: () => cancels++ });
  const state = view.start(host, 2, 'x');
  state.cancelBtn.fire('click');
  assert.equal(cancels, 1);
  assert.equal(view.start(host, 2, 'x'), null);
});
