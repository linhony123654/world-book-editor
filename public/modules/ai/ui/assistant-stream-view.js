import { reasoningDetailsShouldBeOpen, shouldCollapseReasoningAfterStream } from '../../reasoning.js';
import { formatChatText } from './markdown.js';

export function buildAssistantStreamMarkup(content, reasoning, reasoningOpen = false) {
  const parts = [];
  if (reasoning) {
    parts.push(
      '<details class="reasoning-box"' + (reasoningDetailsShouldBeOpen(reasoning, reasoningOpen) ? ' open' : '') + '>' +
      '<summary>思考</summary>' +
      '<div class="reasoning-text">' + formatChatText(reasoning) + '</div>' +
      '</details>'
    );
  }
  if (content) parts.push('<div class="stream-content">' + formatChatText(content) + '</div>');
  else if (!reasoning) parts.push('<span class="typing-cursor">◊</span>');
  return parts.join('');
}

export function createAssistantStreamView({
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis)
} = {}) {
  let pendingFrame = null;

  const renderNow = (msgEl, content, reasoning, reasoningOpen) => {
    if (!msgEl) return;
    const textEl = msgEl.querySelector?.('.stream-content') || null;
    const reasoningBox = msgEl.querySelector?.('.reasoning-box') || null;
    const needRebuild = !textEl || (reasoning && !reasoningBox);

    if (needRebuild) {
      msgEl.innerHTML = buildAssistantStreamMarkup(content, reasoning, reasoningOpen);
      return;
    }

    if (content) textEl.innerHTML = formatChatText(content);
    else if (!reasoning) textEl.innerHTML = '<span class="typing-cursor">◊</span>';

    if (reasoningBox && reasoning) {
      const reasoningText = reasoningBox.querySelector?.('.reasoning-text');
      if (reasoningText) reasoningText.innerHTML = formatChatText(reasoning);
    }
  };

  function render(msgEl, content, reasoning, reasoningOpen = false) {
    const doRender = () => renderNow(msgEl, content, reasoning, reasoningOpen);

    if (reasoningOpen && typeof requestFrame === 'function') {
      if (pendingFrame != null && typeof cancelFrame === 'function') cancelFrame(pendingFrame);
      pendingFrame = requestFrame(() => {
        pendingFrame = null;
        doRender();
      });
      return;
    }

    if (pendingFrame != null && typeof cancelFrame === 'function') cancelFrame(pendingFrame);
    pendingFrame = null;
    doRender();
  }

  function collapse(msgEl, reasoning) {
    if (!shouldCollapseReasoningAfterStream(reasoning) || !msgEl) return false;
    const box = msgEl.querySelector?.('.reasoning-box');
    if (!box) return false;
    box.open = false;
    return true;
  }

  function dispose() {
    if (pendingFrame != null && typeof cancelFrame === 'function') cancelFrame(pendingFrame);
    pendingFrame = null;
  }

  return { render, collapse, dispose };
}
