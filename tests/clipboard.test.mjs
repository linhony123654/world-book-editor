import assert from 'node:assert/strict';
import test from 'node:test';

import { copyText } from '../public/modules/ai/ui/clipboard.js';

function fakeDocument({ execResult = true } = {}) {
  const appended = [];
  let execCalls = 0;
  const body = {
    appendChild(node) { appended.push(node); node.parentElement = body; },
    removeChild(node) {
      const i = appended.indexOf(node);
      if (i >= 0) appended.splice(i, 1);
      node.parentElement = null;
    }
  };
  return {
    appended,
    body,
    get execCalls() { return execCalls; },
    createElement(tag) {
      assert.equal(tag, 'textarea');
      return {
        value: '',
        style: {},
        selected: false,
        parentElement: null,
        select() { this.selected = true; },
        remove() {
          if (this.parentElement) this.parentElement.removeChild(this);
        }
      };
    },
    execCommand(command) {
      execCalls++;
      assert.equal(command, 'copy');
      return execResult;
    }
  };
}

test('clipboard API success avoids textarea fallback', async () => {
  const calls = [];
  const documentRef = fakeDocument();
  const navigatorRef = { clipboard: { async writeText(text) { calls.push(text); } } };
  assert.equal(await copyText('hello', { navigatorRef, documentRef }), true);
  assert.deepEqual(calls, ['hello']);
  assert.equal(documentRef.execCalls, 0);
  assert.equal(documentRef.appended.length, 0);
});

test('clipboard API rejection falls back to hidden textarea and execCommand', async () => {
  const documentRef = fakeDocument();
  const navigatorRef = { clipboard: { async writeText() { throw new Error('denied'); } } };
  assert.equal(await copyText('fallback', { navigatorRef, documentRef }), true);
  assert.equal(documentRef.execCalls, 1);
  assert.equal(documentRef.appended.length, 0);
});

test('missing clipboard API uses fallback and reports execCommand failure', async () => {
  const documentRef = fakeDocument({ execResult: false });
  assert.equal(await copyText('x', { navigatorRef: {}, documentRef }), false);
  assert.equal(documentRef.execCalls, 1);
});

test('empty text is not copied', async () => {
  const documentRef = fakeDocument();
  assert.equal(await copyText('', { navigatorRef: {}, documentRef }), false);
  assert.equal(documentRef.execCalls, 0);
});
