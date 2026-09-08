import assert from 'node:assert/strict';
import test from 'node:test';

import { createUndoHistoryController, isEditableTarget, isUndoShortcut } from '../public/modules/app/undo-history.js';

function element(initial = {}) {
  const listeners = new Map();
  return {
    dataset: {},
    innerHTML: '',
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ target: this, ...event }); },
    click() { return this.emit('click'); },
    ...initial
  };
}

function makeList() {
  const list = element();
  list.querySelectorAll = selector => {
    if (selector !== '.undo-row') return [];
    return [...list.innerHTML.matchAll(/data-idx="(\d+)"/g)].map(match => element({ dataset: { idx: match[1] } }));
  };
  return list;
}

function makeHarness({ entries = [{ uid: 1, title: 'A' }], currentUid = 1, stack = [] } = {}) {
  const elements = { undoBtn: element(), undoModal: element(), undoList: makeList() };
  const keyListeners = [];
  const calls = {
    restoreUndo: 0,
    restoreUndoTo: [],
    sidebar: 0,
    editor: [],
    empty: 0,
    selected: [],
    saves: 0,
    open: [],
    close: [],
    toasts: []
  };
  let undoResult = null;
  let liveStack = stack.slice();
  let liveEntries = entries.slice();
  let liveUid = currentUid;

  const controller = createUndoHistoryController({
    $: id => elements[id] || null,
    documentRef: { addEventListener(type, handler) { if (type === 'keydown') keyListeners.push(handler); } },
    getEntries: () => liveEntries,
    getCurrentUid: () => liveUid,
    getUndoStack: () => liveStack,
    restoreUndo: () => { calls.restoreUndo += 1; return undoResult; },
    restoreUndoTo: idx => { calls.restoreUndoTo.push(idx); },
    renderSidebar: () => { calls.sidebar += 1; },
    renderEditor: entry => calls.editor.push(entry),
    renderEditorEmpty: () => { calls.empty += 1; },
    selectEntry: uid => calls.selected.push(uid),
    scheduleSave: () => { calls.saves += 1; },
    openModal: (...args) => calls.open.push(args),
    closeModal: (...args) => calls.close.push(args),
    escHtml: value => String(value).replaceAll('<', '&lt;'),
    showToast: (...args) => calls.toasts.push(args)
  });

  return {
    controller,
    elements,
    keyListeners,
    calls,
    setUndoResult: value => { undoResult = value; },
    setStack: value => { liveStack = value; },
    setEntries: value => { liveEntries = value; },
    setCurrentUid: value => { liveUid = value; }
  };
}

test('undo shortcut matches Ctrl/Cmd+Z but rejects modified variants', () => {
  assert.equal(isUndoShortcut({ ctrlKey: true, key: 'z' }), true);
  assert.equal(isUndoShortcut({ metaKey: true, key: 'Z' }), true);
  assert.equal(isUndoShortcut({ ctrlKey: true, shiftKey: true, key: 'z' }), false);
  assert.equal(isUndoShortcut({ ctrlKey: true, altKey: true, key: 'z' }), false);
  assert.equal(isUndoShortcut({ ctrlKey: true, key: 's' }), false);
});

test('editable targets preserve native browser undo', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV' }), false);
});

test('undoLast keeps empty-history toast and avoids rerender/save', () => {
  const h = makeHarness();
  assert.equal(h.controller.undoLast(), false);
  assert.equal(h.calls.sidebar, 0);
  assert.equal(h.calls.saves, 0);
  assert.deepEqual(h.calls.toasts.at(-1), ['没有可撤销的操作', 'info']);
});

test('undoLast rerenders current entry, reports label and schedules save', () => {
  const h = makeHarness({ entries: [{ uid: 7, title: 'Seven' }], currentUid: 7 });
  h.setUndoResult('编辑条目');
  assert.equal(h.controller.undoLast(), true);
  assert.equal(h.calls.sidebar, 1);
  assert.equal(h.calls.editor[0].uid, 7);
  assert.equal(h.calls.empty, 0);
  assert.equal(h.calls.saves, 1);
  assert.deepEqual(h.calls.toasts.at(-1), ['已撤销: 编辑条目', 'success']);
});

test('global keydown handles undo but ignores text inputs', () => {
  const h = makeHarness();
  h.setUndoResult('操作');
  h.controller.bind();
  assert.equal(h.keyListeners.length, 1);

  let prevented = 0;
  h.keyListeners[0]({ ctrlKey: true, key: 'z', target: { tagName: 'INPUT' }, preventDefault() { prevented += 1; } });
  assert.equal(h.calls.restoreUndo, 0);
  assert.equal(prevented, 0);

  h.keyListeners[0]({ metaKey: true, key: 'z', target: { tagName: 'DIV' }, preventDefault() { prevented += 1; } });
  assert.equal(h.calls.restoreUndo, 1);
  assert.equal(prevented, 1);
});

test('history markup preserves legacy display order, reverse data indexes and escaping', () => {
  const h = makeHarness({ stack: [{ label: '<old>' }, { label: 'new' }] });
  const html = h.controller.historyMarkup();
  assert.match(html, /data-idx="1"[\s\S]*&lt;old>/);
  assert.match(html, /data-idx="0"[\s\S]*new/);
  assert.ok(html.indexOf('&lt;old>') < html.indexOf('new'));
});

test('rollback restores selected snapshot, reselects live entry, saves and preserves legacy label lookup', () => {
  const h = makeHarness({ entries: [{ uid: 2 }, { uid: 3 }], currentUid: 3, stack: [{ label: 'first' }, { label: 'second' }] });
  const current = h.controller.rollbackTo(1);
  assert.equal(current.uid, 3);
  assert.deepEqual(h.calls.restoreUndoTo, [1]);
  assert.equal(h.calls.sidebar, 1);
  assert.deepEqual(h.calls.selected, [3]);
  assert.equal(h.calls.saves, 1);
  assert.deepEqual(h.calls.toasts.at(-1), ['已回滚到「second」', 'success']);
});

test('undo modal renders rows, binds rollback clicks and opens with undo list focus', () => {
  const h = makeHarness({ stack: [{ label: 'one' }, { label: 'two' }] });
  assert.equal(h.controller.openUndoModal(), true);
  assert.equal(h.calls.open.length, 1);
  assert.equal(h.calls.open[0][0], h.elements.undoModal);
  assert.equal(h.calls.open[0][1].focus, h.elements.undoList);

  const rows = h.elements.undoList.querySelectorAll('.undo-row');
  rows[0].click();
  assert.deepEqual(h.calls.restoreUndoTo, [1]);
  assert.equal(h.calls.close[0][0], h.elements.undoModal);
});
