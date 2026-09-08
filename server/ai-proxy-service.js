function normalizeBase(url) {
  let base = String(url || '').trim().replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/, '');
  base = base.replace(/\/models$/, '');
  if (!base.endsWith('/v1')) base = base.replace(/\/v1$/, '') + '/v1';
  return base;
}

function createAiProxyService({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('AI proxy service requires fetch');

  async function fetchModels(url, key) {
    return fetchImpl(normalizeBase(url) + '/models', {
      headers: { Authorization: 'Bearer ' + key }
    });
  }

  async function fetchChat(url, key, body, signal) {
    return fetchImpl(normalizeBase(url) + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(body),
      signal
    });
  }

  return { fetchModels, fetchChat };
}

module.exports = { createAiProxyService, normalizeBase };
