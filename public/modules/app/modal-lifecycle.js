export const DEFAULT_BACKDROP_MODAL_IDS = Object.freeze([
  'entryModal',
  'bookModal',
  'apiModal',
  'memoryModal',
  'templateModal',
  'smartDraftModal',
  'versionsModal',
  'diffModal'
]);

export function createModalLifecycleController({
  $,
  documentRef = globalThis.document,
  closeModal,
  backdropModalIds = DEFAULT_BACKDROP_MODAL_IDS
} = {}) {
  if (typeof $ !== 'function') throw new TypeError('Modal lifecycle controller requires element lookup');
  if (typeof closeModal !== 'function') throw new TypeError('Modal lifecycle controller requires closeModal');

  function closeByTrigger(button) {
    const modal = $(button?.dataset?.closeModal);
    closeModal(modal);
    return modal || null;
  }

  function bindCloseTriggers() {
    documentRef?.querySelectorAll?.('[data-close-modal]').forEach(button => {
      button.addEventListener('click', () => closeByTrigger(button));
    });
  }

  function bindBackdropDismiss() {
    backdropModalIds.forEach(id => {
      const modal = $(id);
      if (!modal) return;
      modal.addEventListener('click', event => {
        if (event.target === modal) closeModal(modal);
      });
    });
  }

  function bind() {
    bindCloseTriggers();
    bindBackdropDismiss();
  }

  return {
    bind,
    bindBackdropDismiss,
    bindCloseTriggers,
    closeByTrigger
  };
}
