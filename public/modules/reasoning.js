export function extractReasoningDelta(delta) {
  if (!delta) return '';
  if (typeof delta.reasoning_content === 'string') return delta.reasoning_content;
  if (typeof delta.reasoning === 'string') return delta.reasoning;
  if (delta.reasoning && typeof delta.reasoning.content === 'string') return delta.reasoning.content;
  return '';
}

export function hasVisibleAssistantStream(content, reasoning) {
  return !!(String(content || '').trim() || String(reasoning || '').trim());
}

export function shouldCollapseReasoningAfterStream(reasoning) {
  return !!String(reasoning || '').trim();
}

export function reasoningDetailsShouldBeOpen(reasoning, isStreaming) {
  return !!String(reasoning || '').trim() && !!isStreaming;
}
