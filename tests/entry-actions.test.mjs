import assert from 'node:assert/strict';
import test from 'node:test';

import { createEntryActionsController, isSaveShortcut } from '../public/modules/app/entry-actions.js';

function element(initial = {}) {
  const listeners = new Map();
  return {
    value: '',
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ target: this, ...event }); },
    click(event = {}) { return this.emit('click', event); },
    ...initial
  };
}

function makeHarness() {
  const elements = {
    newEntryBtn: element(),
    createEntryBtn: element(),
    newTitleInput: element(),
    entryModal: element(),
    deleteBtn: element(),
    duplicateBtn: element(),
    saveBtn: element(),
    quickSaveBtn: element()
  };
  const keyListeners = [];
  const calls = {
    created: [],
    deleted: [],
    duplicated: [],
    saves: 0,
    open: [],
    close: [],
    screens: [],
    toasts: []
  };
  const controller = createEntryActionsController({
    $: id => elements[id] || null,
    documentRef: { addEventListener(type, handler) { if (type === 'keydown') keyListeners.push(handler); } },
    newEntry: title => calls.created.push(title),
    deleteEntry: event => calls.deleted.push(event),
    duplicateEntry: event => calls.duplicated.push(event),
    autoSave: async () => { calls.saves += 1; },
    openModal: (...args) => calls.open.push(args),
    closeModal: (...args) => calls.close.push(args),
    setScreen: name => calls.screens.push(name),
    showToast: (...args) => calls.toasts.push(args)
  });
  return { controller, elements, keyListeners, calls };
}

test('save shortcut matches Ctrl/Cmd+S and rejects modified variants', () => {
  assert.equal(isSaveShortcut({ ctrlKey: true, key: 's' }), true);
  assert.equal(isSaveShortcut({ metaKey: true, key: 'S' }), true);
  assert.equal(isSaveShortcut({ ctrlKey: true, shiftKey: true, key: 's' }), false);
  assert.equal(isSaveShortcut({ ctrlKey: true, altKey: true, key: 's' }), false);
  assert.equal(isSaveShortcut({ ctrlKey: true, key: 'z' }), false);
});

test('openEntryModal clears previous title and focuses title input', () => {
  const h = makeHarness();
  h.elements.newTitleInput.value = 'old title';
  h.controller.openEntryModal();
  assert.equal(h.elements.newTitleInput.value, '');
  assert.equal(h.calls.open[0][0], h.elements.entryModal);
  assert.equal(h.calls.open[0][1].focus, h.elements.newTitleInput);
});

test('createEntry trims title, closes modal and navigates to editor', () => {
  const h = makeHarness();
  h.elements.newTitleInput.value = '  北境  ';
  assert.equal(h.controller.createEntry(), '北境');
  assert.deepEqual(h.calls.created, ['北境']);
  assert.equal(h.calls.close[0][0], h.elements.entryModal);
  assert.deepEqual(h.calls.screens, ['editor']);
});

test('createEntry preserves legacy empty-title behavior', () => {
  const h = makeHarness();
  h.elements.newTitleInput.value = '   ';
  h.controller.createEntry();
  assert.deepEqual(h.calls.created, ['']);
});

test('title Enter prevents default and creates while other keys are ignored', () => {
  const h = makeHarness();
  h.elements.newTitleInput.value = '角色';
  let prevented = 0;
  assert.equal(h.controller.onTitleKeydown({ key: 'x', preventDefault() { prevented += 1; } }), false);
  assert.equal(h.controller.onTitleKeydown({ key: 'Enter', preventDefault() { prevented += 1; } }), true);
  assert.equal(prevented, 1);
  assert.deepEqual(h.calls.created, ['角色']);
});

test('manualSave awaits autosave then preserves success toast', async () => {
  const h = makeHarness();
  assert.equal(await h.controller.manualSave(), true);
  assert.equal(h.calls.saves, 1);
  assert.deepEqual(h.calls.toasts.at(-1), ['已保存', 'success']);
});

test('bind wires create/delete/duplicate/save buttons and one global save shortcut', async () => {
  const h = makeHarness();
  h.controller.bind();
  assert.equal(h.keyListeners.length, 1);

  h.elements.newEntryBtn.click();
  h.elements.newTitleInput.value = '新条目';
  h.elements.createEntryBtn.click();
  const deleteEvent = { marker: 'delete' };
  const duplicateEvent = { marker: 'duplicate' };
  h.elements.deleteBtn.click(deleteEvent);
  h.elements.duplicateBtn.click(duplicateEvent);
  await h.elements.saveBtn.click();
  await h.elements.quickSaveBtn.click();

  assert.deepEqual(h.calls.created, ['新条目']);
  assert.equal(h.calls.deleted.length, 1);
  assert.equal(h.calls.deleted[0].marker, 'delete');
  assert.equal(h.calls.duplicated.length, 1);
  assert.equal(h.calls.duplicated[0].marker, 'duplicate');
  assert.equal(h.calls.saves, 2);

  let prevented = 0;
  h.keyListeners[0]({ ctrlKey: true, key: 's', target: { tagName: 'INPUT' }, preventDefault() { prevented += 1; } });
  await Promise.resolve();
  assert.equal(prevented, 1);
  assert.equal(h.calls.saves, 3);
});
