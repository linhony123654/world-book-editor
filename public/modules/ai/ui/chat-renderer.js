import { escHtml } from '../../utils.js';

const ROLE_LABELS = Object.freeze({
  user: '你',
  assistant: 'AI',
  tool: '工具',
  error: '错误'
});

const CHANGE_ICONS = Object.freeze({
  add: '＋',
  delete: '✕',
  edit: '✎',
  merge: '⤷',
  split: '⧉',
  other: '·'
});

export function chatRoleLabel(role) {
  return ROLE_LABELS[role] || role;
}

export function buildChatMessageMarkup(role, text) {
  return '<div class="chat-msg-role">' + chatRoleLabel(role) + '</div>' +
    '<div class="chat-msg-text">' + escHtml(text) + '</div>';
}

export function parseToolTraceLine(text) {
  const value = String(text == null ? '' : text);
  const sep = value.indexOf(': ');
  return {
    name: sep > 0 ? value.slice(0, sep) : value,
    summary: sep > 0 ? value.slice(sep + 2) : ''
  };
}

export function buildToolTraceLineMarkup(text) {
  const { name, summary } = parseToolTraceLine(text);
  return '<span class="tool-line-name">' + escHtml(name) + '</span>' +
    (summary ? '<span class="tool-line-sum">' + escHtml(summary) + '</span>' : '');
}

export function buildChangeLabel(change = {}) {
  const icon = CHANGE_ICONS[change.type] || CHANGE_ICONS.other;
  return icon + ' ' + (change.tool || '') +
    (change.comment ? '「' + change.comment + '」' : '') +
    (change.detail ? ' — ' + change.detail : '');
}

export function shouldScrollAfterMessage(role, nearBottom) {
  return role === 'user' || role === 'error' || !!nearBottom;
}

function removeWelcome(container) {
  const welcome = container?.querySelector?.('.chat-welcome');
  if (welcome) welcome.remove();
}

export function createChatRenderer({
  documentRef = globalThis.document,
  getContainer,
  getMessageCount = () => 0,
  attachAssistantActions = () => {},
  attachUserActions = () => {},
  applyVisibleLimit = () => {},
  isNearBottom = () => true,
  scrollToBottom = () => {},
  onOpenEntry = () => {},
  onUndoTurn = () => {},
  getTurnUndoBase = () => 0
} = {}) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createChatRenderer requires a DOM-like document');
  }
  if (typeof getContainer !== 'function') {
    throw new TypeError('createChatRenderer requires getContainer');
  }

  function appendToolLine(text, suppliedContainer) {
    const container = suppliedContainer || getContainer();
    if (!container) return null;

    let group = container.lastElementChild;
    if (!group || !group.classList.contains('tool-group')) {
      group = documentRef.createElement('details');
      group.className = 'tool-group';
      group.innerHTML =
        '<summary class="tool-sum">' +
          '<span class="tool-ico">⚙</span>' +
          '<span class="tool-sum-label">工具调用</span>' +
          '<span class="tool-count">0</span>' +
          '<span class="tool-latest"></span>' +
        '</summary><div class="tool-lines"></div>';
      container.appendChild(group);
    }

    const lines = group.querySelector('.tool-lines');
    const { name, summary } = parseToolTraceLine(text);
    const line = documentRef.createElement('div');
    line.className = 'tool-line';
    line.innerHTML = buildToolTraceLineMarkup(text);
    lines.appendChild(line);
    group.querySelector('.tool-count').textContent = lines.children.length;
    group.querySelector('.tool-latest').textContent = summary || name;
    applyVisibleLimit();
    if (isNearBottom()) scrollToBottom();
    return line;
  }

  function appendMessage(role, text, idx) {
    const container = getContainer();
    if (!container) return null;
    removeWelcome(container);

    if (role === 'tool') return appendToolLine(text, container);

    const div = documentRef.createElement('div');
    div.className = 'chat-msg chat-msg-' + role;
    div.dataset.idx = idx != null ? idx : getMessageCount();
    div.innerHTML = buildChatMessageMarkup(role, text);
    container.appendChild(div);

    if (role === 'assistant') attachAssistantActions(div, div.dataset.idx);
    else if (role === 'user') attachUserActions(div, div.dataset.idx);

    applyVisibleLimit();
    if (shouldScrollAfterMessage(role, isNearBottom())) scrollToBottom();
    return div;
  }

  function createAssistantBubble() {
    const container = getContainer();
    if (!container) return null;
    removeWelcome(container);

    const div = documentRef.createElement('div');
    div.className = 'chat-msg chat-msg-assistant';
    div.innerHTML = '<div class="chat-msg-role">AI</div><div class="chat-msg-text"><span class="typing-cursor">◊</span></div>';
    container.appendChild(div);
    applyVisibleLimit();
    scrollToBottom();
    return div.querySelector('.chat-msg-text');
  }

  function appendChangesCard(changes = []) {
    const container = getContainer();
    if (!container) return null;
    removeWelcome(container);

    const div = documentRef.createElement('div');
    div.className = 'chat-msg chat-msg-changes';

    const head = documentRef.createElement('div');
    head.className = 'chat-msg-role';
    head.textContent = '本轮改动 · ' + changes.length + ' 项';

    const list = documentRef.createElement('div');
    list.className = 'changes-list';
    for (const change of changes) {
      const btn = documentRef.createElement('button');
      btn.type = 'button';
      btn.className = 'change-item' + (change.type === 'delete' ? ' del' : '');
      btn.textContent = buildChangeLabel(change);
      btn.title = change.type === 'delete' ? '该条目已删除' : '打开条目';
      if (change.uid != null && change.type !== 'delete') {
        const uid = change.uid;
        btn.addEventListener('click', () => onOpenEntry(uid));
      } else {
        btn.disabled = true;
      }
      list.appendChild(btn);
    }

    const undoBtn = documentRef.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'changes-undo';
    undoBtn.textContent = '⟲ 撤销本轮 ' + changes.length + ' 项';
    undoBtn.addEventListener('click', () => onUndoTurn(getTurnUndoBase()));

    div.appendChild(head);
    div.appendChild(list);
    div.appendChild(undoBtn);
    container.appendChild(div);
    applyVisibleLimit();
    if (isNearBottom()) scrollToBottom();
    return div;
  }

  return {
    appendMessage,
    appendToolLine,
    appendChangesCard,
    createAssistantBubble
  };
}
