// ===== AI transport =====
// Owns the OpenAI-compatible streaming wire protocol and the local proxy request.
// No conversation state, DOM rendering or world-book mutation belongs here.

export async function* streamSSE(response) {
  if (!response || !response.body || typeof response.body.getReader !== 'function') {
    throw new Error('stream response body is unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5);
      if (data === '[DONE]') return;
      try { yield JSON.parse(data); } catch {}
    }
  }

  // Some compatible gateways omit a trailing newline. Parse a final complete data frame.
  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const data = tail.startsWith('data: ') ? tail.slice(6) : tail.slice(5);
    if (data !== '[DONE]') {
      try { yield JSON.parse(data); } catch {}
    }
  }
}

export async function streamFetch(apiUrl, apiKey, body, signal) {
  const { authHeaders } = await import('../auth.js');
  const resp = await fetch('/api/proxy/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ url: apiUrl, key: apiKey, body: { ...body, stream: true } }),
    signal
  });
  if (!resp.ok) throw new Error('API ' + resp.status + ': ' + await resp.text());
  return resp;
}
