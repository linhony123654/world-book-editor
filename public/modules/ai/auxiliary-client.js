import { streamFetch, streamSSE } from './transport.js';

export const AUX_REQUEST_TIMEOUT_MS = 60000;

/**
 * Small completion client for background/auxiliary AI tasks such as:
 * - session title generation;
 * - memory rollups;
 * - writing-template generation;
 * - smart-draft completion helpers.
 *
 * Main chat streaming remains owned by the conversation adapter because it
 * needs incremental DOM rendering. This client deliberately returns only the
 * final trimmed text.
 */
export function createAuxiliaryCompletionClient({
  getConfig = () => ({}),
  streamRequest = streamFetch,
  parseStream = streamSSE,
  timeoutMs = AUX_REQUEST_TIMEOUT_MS,
  AbortControllerImpl = globalThis.AbortController,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id)
} = {}) {
  if (typeof getConfig !== 'function') throw new TypeError('getConfig must be a function');
  if (typeof streamRequest !== 'function') throw new TypeError('streamRequest must be a function');
  if (typeof parseStream !== 'function') throw new TypeError('parseStream must be a function');
  if (typeof AbortControllerImpl !== 'function') throw new TypeError('AbortControllerImpl must be a constructor');

  async function complete(messages, overrides = {}) {
    const config = { ...(await getConfig()), ...(overrides || {}) };
    const apiUrl = config.apiUrl;
    const apiKey = config.apiKey;
    const model = config.model || 'gpt-4o';
    if (!apiUrl || !apiKey) throw new Error('未配置 API');

    const controller = new AbortControllerImpl();
    const timer = setTimer(() => {
      try { controller.abort(); } catch {}
    }, timeoutMs);

    try {
      const response = await streamRequest(
        apiUrl,
        apiKey,
        { model, messages },
        controller.signal
      );
      let content = '';
      for await (const chunk of parseStream(response)) {
        const delta = chunk && chunk.choices && chunk.choices[0]
          ? chunk.choices[0].delta
          : null;
        if (delta && delta.content) content += delta.content;
      }
      return content.trim();
    } finally {
      clearTimer(timer);
    }
  }

  return { complete };
}
