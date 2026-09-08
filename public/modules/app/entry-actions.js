export function isSaveShortcut(event) {
  if (!event || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
  return String(event.key || '').toLowerCase() === 's';
}

export function createEntryActionsController({
  $,
  documentRef = globalThis.document,
  newEntry,
  deleteEntry,
  duplicateEntry,
  autoSave,
  openModal = () => {},
  closeModal = () => {},
  setScreen = () => {},
  showToast = () => {}
} = {}) {
  if (typeof $ !== 'function') throw new TypeError('Entry actions controller requires element lookup');
  if (typeof newEntry !== 'function') throw new TypeError('Entry actions controller requires newEntry');
  if (typeof autoSave !== 'function') throw new TypeError('Entry actions controller requires autoSave');

  function openEntryModal() {
    const input = $('newTitleInput');
    if (input) input.value = '';
    openModal($('entryModal'), { focus: input });
  }

  function createEntry() {
    const input = $('newTitleInput');
    const title = (input && input.value.trim()) || '';
    newEntry(title);
    closeModal($('entryModal'));
    setScreen('editor');
    return title;
  }

  function onTitleKeydown(event) {
    if (event.key !== 'Enter') return false;
    event.preventDefault?.();
    createEntry();
    return true;
  }

  async function manualSave() {
    await autoSave();
    showToast('已保存', 'success');
    return true;
  }

  function onGlobalKeydown(event) {
    if (!isSaveShortcut(event)) return false;
    event.preventDefault?.();
    manualSave();
    return true;
  }

  function bind() {
    $('newEntryBtn')?.addEventListener('click', openEntryModal);
    $('createEntryBtn')?.addEventListener('click', createEntry);
    $('newTitleInput')?.addEventListener('keydown', onTitleKeydown);
    if (typeof deleteEntry === 'function') $('deleteBtn')?.addEventListener('click', deleteEntry);
    if (typeof duplicateEntry === 'function') $('duplicateBtn')?.addEventListener('click', duplicateEntry);
    $('saveBtn')?.addEventListener('click', manualSave);
    $('quickSaveBtn')?.addEventListener('click', manualSave);
    documentRef?.addEventListener?.('keydown', onGlobalKeydown);
  }

  return {
    bind,
    createEntry,
    manualSave,
    onGlobalKeydown,
    onTitleKeydown,
    openEntryModal
  };
}
