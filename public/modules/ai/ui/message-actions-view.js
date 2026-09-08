const ACTION_SVGS = Object.freeze({
  resend: '<svg class="icon" viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a9 9 0 0 1 15-6.7L21 8"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a9 9 0 0 1-15 6.7L3 16"/></svg><span>重新生成</span>',
  copy: '<svg class="icon" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>复制</span>',
  edit: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>编辑</span>',
  delete: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg><span>删除</span>'
});

const ACTION_LABELS = Object.freeze({
  resend: '重新生成',
  copy: '复制这条消息',
  edit: '编辑这条消息',
  delete: '删除这条消息'
});

export function messageActionKinds(role) {
  if (role === 'assistant') return ['resend', 'copy', 'edit', 'delete'];
  if (role === 'user') return ['copy', 'edit', 'delete'];
  return [];
}

export function messageTokenPill(message, tokenBudget = 16000) {
  const tokens = Number(message?.tokens) || 0;
  if (!tokens) return null;
  return {
    className: 'chat-token-pill' + (tokens > tokenBudget ? ' over' : ''),
    text: '≈ ' + tokens.toLocaleString() + ' tok',
    title: '该轮发送给模型的上下文估算'
  };
}

function actionButton(documentRef, kind, handler) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'chat-msg-act';
  button.title = ACTION_LABELS[kind];
  button.setAttribute('aria-label', ACTION_LABELS[kind]);
  button.innerHTML = ACTION_SVGS[kind];
  button.addEventListener('click', handler);
  return button;
}

export function createMessageActionsView({
  documentRef = globalThis.document,
  getMessages,
  getTokenBudget = () => 16000,
  onResend = () => {},
  onCopy = () => {},
  onEdit = () => {},
  onDelete = () => {}
} = {}) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createMessageActionsView requires a DOM-like document');
  }
  if (typeof getMessages !== 'function') {
    throw new TypeError('createMessageActionsView requires getMessages');
  }

  function attach(msgEl, idx) {
    const host = msgEl?.classList?.contains('chat-msg-text') ? msgEl.parentElement : msgEl;
    if (!host || host.querySelector?.('.chat-msg-actions')) return null;

    const messages = getMessages();
    const i = idx != null ? Number(idx) : messages.length - 1;
    const message = messages[i];
    if (!message || messageActionKinds(message.role).length === 0) return null;

    const row = documentRef.createElement('div');
    row.className = 'chat-msg-actions';

    for (const kind of messageActionKinds(message.role)) {
      const handler = kind === 'resend'
        ? () => onResend(i, msgEl)
        : kind === 'copy'
          ? () => onCopy(i, msgEl)
          : kind === 'edit'
            ? () => onEdit(i, msgEl)
            : () => onDelete(i, msgEl);
      row.appendChild(actionButton(documentRef, kind, handler));
    }

    if (message.role === 'assistant') {
      const pillData = messageTokenPill(message, getTokenBudget());
      if (pillData) {
        const pill = documentRef.createElement('span');
        pill.className = pillData.className;
        pill.textContent = pillData.text;
        pill.title = pillData.title;
        row.appendChild(pill);
      }
    }

    host.appendChild(row);
    return row;
  }

  return { attach };
}
