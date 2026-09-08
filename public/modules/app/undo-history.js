export function isUndoShortcut(event) {
  if (!event || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
  return String(event.key || '').toLowerCase() === 'z';
}

export function isEditableTarget(target) {
  if (!target) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || Boolean(target.isContentEditable);
}

export function createUndoHistoryController({
  $,
  documentRef = globalThis.document,
  getEntries = () => [],
  getCurrentUid = () => null,
  getUndoStack = () => [],
  restoreUndo,
  restoreUndoTo,
  renderSidebar = () => {},
  renderEditor = () => {},
  renderEditorEmpty = () => {},
  selectEntry = () => {},
  scheduleSave = () => {},
  openModal = () => {},
  closeModal = () => {},
  escHtml = value => String(value ?? ''),
  showToast = () => {}
} = {}) {
  if (typeof $ !== 'function') throw new TypeError('Undo history controller requires element lookup');
  if (typeof restoreUndo !== 'function') throw new TypeError('Undo history controller requires restoreUndo');
  if (typeof restoreUndoTo !== 'function') throw new TypeError('Undo history controller requires restoreUndoTo');

  function undoLast() {
    const label = restoreUndo();
    if (!label) {
      showToast('没有可撤销的操作', 'info');
      return false;
    }

    renderSidebar();
    const entries = getEntries() || [];
    const currentUid = getCurrentUid();
    if (currentUid != null) {
      const entry = entries.find(item => item.uid === currentUid);
      if (entry) renderEditor(entry);
      else renderEditorEmpty();
    } else {
      renderEditorEmpty();
    }
    showToast('已撤销: ' + label, 'success');
    scheduleSave();
    return true;
  }

  function historyMarkup(stack = getUndoStack() || []) {
    if (!stack.length) {
      return '<div class="undo-empty">暂无撤销历史。编辑条目或让 AI 修改后，操作会出现在这里。</div>';
    }

    return stack.map((snapshot, i) => {
      const idx = stack.length - 1 - i;
      const ts = snapshot.ts
        ? new Date(snapshot.ts).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : '';
      return '<button type="button" class="undo-row" data-idx="' + idx + '">' +
        '<span class="undo-no">' + (i + 1) + '</span>' +
        '<span class="undo-label">' + escHtml(snapshot.label || '操作') + '</span>' +
        (ts ? '<small class="undo-ts">' + ts + '</small>' : '') +
        '</button>';
    }).join('');
  }

  function rollbackTo(idx) {
    restoreUndoTo(idx);
    renderSidebar();
    const entries = getEntries() || [];
    const currentUid = getCurrentUid();
    const current = entries.find(item => item.uid === currentUid) || entries[0];
    if (current) selectEntry(current.uid);
    else renderEditorEmpty();
    scheduleSave();

    const stackAfterRestore = getUndoStack() || [];
    const label = stackAfterRestore[idx] ? stackAfterRestore[idx].label : '最早记录';
    showToast('已回滚到「' + label + '」', 'success');
    return current || null;
  }

  function openUndoModal() {
    const modal = $('undoModal');
    if (!modal) return false;
    const listEl = $('undoList');
    if (listEl) {
      listEl.innerHTML = historyMarkup();
      listEl.querySelectorAll?.('.undo-row').forEach(row => {
        row.addEventListener('click', () => {
          const idx = parseInt(row.dataset.idx);
          rollbackTo(idx);
          closeModal(modal);
        });
      });
    }
    openModal(modal, { focus: $('undoList') });
    return true;
  }

  function onKeydown(event) {
    if (!isUndoShortcut(event) || isEditableTarget(event.target)) return false;
    event.preventDefault?.();
    undoLast();
    return true;
  }

  function bind() {
    $('undoBtn')?.addEventListener('click', openUndoModal);
    documentRef?.addEventListener?.('keydown', onKeydown);
  }

  return {
    bind,
    historyMarkup,
    onKeydown,
    openUndoModal,
    rollbackTo,
    undoLast
  };
}
