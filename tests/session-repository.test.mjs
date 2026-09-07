import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiDataRepository } from '../public/modules/ai/session/repository.js';

test('read forwards auth headers and parses JSON', async () => {
  const calls = [];
  const repository = createAiDataRepository({
    getAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ sessions: [1] }) };
    }
  });

  assert.deepEqual(await repository.read(7), { sessions: [1] });
  assert.equal(calls[0].url, '/api/ai-data/7');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test');
});

test('read preserves legacy HTTP status error behavior', async () => {
  const repository = createAiDataRepository({
    fetchImpl: async () => ({ ok: false, status: 401 })
  });
  await assert.rejects(() => repository.read(3), /HTTP 401/);
});

test('writes are serialized and preserve request shape', async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let callIndex = 0;

  const repository = createAiDataRepository({
    getAuthHeaders: () => ({ 'X-Auth': 'yes' }),
    fetchImpl: async (url, init) => {
      callIndex += 1;
      const index = callIndex;
      events.push('start-' + index);
      if (index === 1) await firstGate;
      events.push('end-' + index);
      assert.equal(url, '/api/ai-data/9');
      assert.equal(init.method, 'PUT');
      assert.equal(init.headers['Content-Type'], 'application/json');
      assert.equal(init.headers['X-Auth'], 'yes');
      return { ok: true, status: 200 };
    }
  });

  const first = repository.write(9, { sessions: ['a'] });
  const second = repository.write(9, { sessions: ['b'] });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ['start-1']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('write errors are reported but do not reject the queue', async () => {
  const errors = [];
  let attempts = 0;
  const repository = createAiDataRepository({
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return { ok: true, status: 200 };
    },
    onWriteError: (error, bookId) => errors.push([error.message, bookId])
  });

  await repository.write(2, { a: 1 });
  await repository.write(2, { a: 2 });
  assert.equal(attempts, 2);
  assert.deepEqual(errors, [['offline', 2]]);
});
