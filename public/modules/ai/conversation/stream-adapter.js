// OpenAI-compatible assistant stream aggregation.
// Protocol parsing is DOM-agnostic; rendering/follow-scroll stay injected by the controller/view.

export function mergeToolCallDelta(toolCalls, deltaCalls) {
  const target = Array.isArray(toolCalls) ? toolCalls : [];
  for (const tc of (Array.isArray(deltaCalls) ? deltaCalls : [])) {
    const index = tc?.index ?? 0;
    if (!target[index]) {
      target[index] = {
        id: tc?.id || '',
        type: 'function',
        function: { name: '', arguments: '' }
      };
    }
    if (tc?.id) target[index].id = tc.id;
    if (tc?.function?.name) target[index].function.name += tc.function.name;
    if (tc?.function?.arguments) target[index].function.arguments += tc.function.arguments;
  }
  return target;
}

export function compactToolCalls(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .filter(call => call && call.function && call.function.name);
}

export async function consumeAssistantStream(chunks, {
  extractReasoning = () => '',
  onUpdate = () => {},
  onComplete = () => {}
} = {}) {
  let content = '';
  let reasoning = '';
  const toolCalls = [];

  for await (const chunk of chunks) {
    const delta = chunk?.choices?.[0]?.delta;
    if (!delta) continue;

    const reasoningDelta = extractReasoning(delta);
    if (reasoningDelta) {
      reasoning += reasoningDelta;
      await onUpdate({ content, reasoning, kind: 'reasoning' });
    }

    if (delta.content) {
      content += delta.content;
      await onUpdate({ content, reasoning, kind: 'content' });
    }

    if (delta.tool_calls) mergeToolCallDelta(toolCalls, delta.tool_calls);
  }

  await onComplete({ content, reasoning });
  const compact = compactToolCalls(toolCalls);
  return {
    content,
    reasoning,
    tool_calls: compact.length ? compact : null
  };
}
