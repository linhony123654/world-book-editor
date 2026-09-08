export function createAiDataRepository({
  fetchImpl = globalThis.fetch,
  getAuthHeaders = async () => ({}),
  onWriteError = () => {}
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof getAuthHeaders !== 'function') throw new TypeError('getAuthHeaders must be a function');

  let writeQueue = Promise.resolve();

  async function headers(extra = {}) {
    const auth = await getAuthHeaders();
    return { ...extra, ...(auth || {}) };
  }

  async function read(bookId) {
    const response = await fetchImpl('/api/ai-data/' + bookId, {
      headers: await headers()
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  // Writes are deliberately serialized because the endpoint stores one whole
  // AI-data document. Concurrent PUTs could otherwise overwrite newer session
  // or memory state with an older payload.
  function write(bookId, payload) {
    writeQueue = writeQueue.then(async () => {
      try {
        await fetchImpl('/api/ai-data/' + bookId, {
          method: 'PUT',
          headers: await headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });
      } catch (error) {
        onWriteError(error, bookId);
      }
    });
    return writeQueue;
  }

  return { read, write };
}
