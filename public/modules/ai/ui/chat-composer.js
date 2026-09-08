export function isChatSendKey(event) {
  return !!event && event.key === 'Enter' && !event.shiftKey;
}

export function chatInputHeight(scrollHeight, maxHeight = 120) {
  const height = Number(scrollHeight) || 0;
  return Math.min(Math.max(0, height), maxHeight);
}

export function applyComposerBusyState(sendButton, input, busy) {
  const value = !!busy;
  if (sendButton) {
    sendButton.classList.toggle('is-busy', value);
    // Busy remains clickable because the same button becomes Stop.
    sendButton.disabled = false;
    sendButton.setAttribute('aria-label', value ? '停止生成' : '发送');
  }
  if (input) input.classList.toggle('sending', value);
}

export function resizeChatInput(input, maxHeight = 120) {
  if (!input) return 0;
  input.style.height = 'auto';
  const height = chatInputHeight(input.scrollHeight, maxHeight);
  input.style.height = height + 'px';
  return height;
}

export function createChatComposer({
  sendButton = null,
  input = null,
  scroller = null,
  toBottomButton = null,
  getIsSending = () => false,
  onSend = () => {},
  onStop = () => {},
  onScroll = () => {},
  onToBottom = () => {},
  maxInputHeight = 120
} = {}) {
  const listeners = [];
  let bound = false;

  function listen(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, options);
    listeners.push({ target, type, handler, options });
  }

  function bind() {
    if (bound) return;
    bound = true;

    listen(sendButton, 'click', () => {
      if (getIsSending()) onStop();
      else onSend();
    });

    listen(scroller, 'scroll', onScroll, { passive: true });
    listen(toBottomButton, 'click', onToBottom);

    listen(input, 'keydown', event => {
      if (!isChatSendKey(event)) return;
      event.preventDefault();
      onSend();
    });

    listen(input, 'input', () => resizeChatInput(input, maxInputHeight));
  }

  function setBusy(busy) {
    applyComposerBusyState(sendButton, input, busy);
  }

  function resetInputHeight() {
    if (input) input.style.height = 'auto';
  }

  function dispose() {
    for (const { target, type, handler, options } of listeners.splice(0)) {
      target.removeEventListener?.(type, handler, options);
    }
    bound = false;
  }

  return { bind, setBusy, resetInputHeight, dispose };
}
