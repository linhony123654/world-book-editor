import assert from 'node:assert/strict';
import test from 'node:test';

import { createModalLifecycleController, DEFAULT_BACKDROP_MODAL_IDS } from '../public/modules/app/modal-lifecycle.js';

function element(initial = {}) {
  const listeners = new Map();
  return {
    dataset: {},
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ target: this, ...event }); },
    click(event = {}) { return this.emit('click', event); },
    ...initial
  };
}

function makeHarness() {
  const trigger = element({ dataset: { closeModal: 'entryModal' } });
  const entryModal = element();
  const apiModal = element();
  const elements = { entryModal, apiModal };
  const closed = [];
  const controller = createModalLifecycleController({
    $: id => elements[id] || null,
    documentRef: {
      querySelectorAll(selector) {
        return selector === '[data-close-modal]' ? [trigger] : [];
      }
    },
    closeModal: modal => closed.push(modal),
    backdropModalIds: ['entryModal', 'missingModal', 'apiModal']
  });
  return { controller, trigger, entryModal, apiModal, closed };
}

test('default backdrop modal registry preserves current modal ids and order', () => {
  assert.deepEqual(DEFAULT_BACKDROP_MODAL_IDS, [
    'entryModal', 'bookModal', 'apiModal', 'memoryModal',
    'templateModal', 'smartDraftModal', 'versionsModal', 'diffModal'
  ]);
});

test('data-close-modal trigger resolves target by id and delegates close', () => {
  const h = makeHarness();
  assert.equal(h.controller.closeByTrigger(h.trigger), h.entryModal);
  assert.deepEqual(h.closed, [h.entryModal]);
});

test('unknown data-close-modal target preserves legacy closeModal call with null', () => {
  const h = makeHarness();
  h.trigger.dataset.closeModal = 'missingModal';
  assert.equal(h.controller.closeByTrigger(h.trigger), null);
  assert.deepEqual(h.closed, [null]);
});

test('bind wires close triggers and dismisses only direct backdrop clicks', () => {
  const h = makeHarness();
  h.controller.bind();

  h.trigger.click();
  assert.deepEqual(h.closed, [h.entryModal]);

  h.entryModal.emit('click', { target: {} });
  assert.deepEqual(h.closed, [h.entryModal]);

  h.entryModal.emit('click', { target: h.entryModal });
  h.apiModal.emit('click', { target: h.apiModal });
  assert.deepEqual(h.closed, [h.entryModal, h.entryModal, h.apiModal]);
});
