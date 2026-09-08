export function resolveMessageHost(msgEl) {
  if (!msgEl) return null;
  return msgEl.classList?.contains('chat-msg-text') ? msgEl.parentElement : msgEl;
}

export function resolveMessageTextElement(msgEl) {
  if (!msgEl) return null;
  return msgEl.classList?.contains('chat-msg-text') ? msgEl : msgEl.querySelector?.('.chat-msg-text');
}

export function normalizedMessageEditValue(value) {
  return String(value ?? '').trim();
}

export function createMessageEditView({
  documentRef = globalThis.document,
  onSave = () => {},
  onCancel = () => {},
  onEmpty = () => {}
} = {}) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createMessageEditView requires a DOM-like document');
  }

  function start(msgEl, index, initialValue) {
    const host = resolveMessageHost(msgEl);
    const textEl = resolveMessageTextElement(msgEl);
    if (!host || !textEl || host.classList?.contains('chat-msg-editing')) return null;

    host.classList.add('chat-msg-editing');

    const textarea = documentRef.createElement('textarea');
    textarea.className = 'chat-msg-edit-textarea';
    textarea.value = String(initialValue ?? '');

    const saveBtn = documentRef.createElement('button');
    saveBtn.className = 'action primary';
    saveBtn.textContent = '保存';

    const cancelBtn = documentRef.createElement('button');
    cancelBtn.className = 'action';
    cancelBtn.textContent = '取消';

    const actions = documentRef.createElement('div');
    actions.className = 'chat-msg-edit-actions';
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    textEl.innerHTML = '';
    textEl.appendChild(textarea);
    textEl.appendChild(actions);
    textarea.focus?.();

    saveBtn.addEventListener('click', () => {
      const value = normalizedMessageEditValue(textarea.value);
      if (!value) {
        onEmpty(index, msgEl);
        return;
      }
      onSave(index, value, msgEl);
    });
    cancelBtn.addEventListener('click', () => onCancel(index, msgEl));

    return { host, textEl, textarea, saveBtn, cancelBtn, actions };
  }

  return { start };
}
