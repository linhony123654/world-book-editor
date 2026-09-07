import assert from 'node:assert/strict';
import test from 'node:test';

import { streamSSE } from '../public/modules/ai/transport.js';

function responseFromChunks(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(stream, { status: 200 });
}

async function collect(response) {
  const out = [];
  for await (const item of streamSSE(response)) out.push(item);
  return out;
}

test('streamSSE handles frames split across chunks and DONE', async () => {
  const response = responseFromChunks([
    'data: {"choices":[{"delta":{"content":"你"}}]}\n',
    '\ndata:{"choices":[{"delta":{"content":"好"}}]}\n\n',
    'data: [DONE]\n\n'
  ]);
  const result = await collect(response);
  assert.equal(result.length, 2);
  assert.equal(result[0].choices[0].delta.content, '你');
  assert.equal(result[1].choices[0].delta.content, '好');
});

test('streamSSE ignores malformed frames and parses a final frame without newline', async () => {
  const response = responseFromChunks([
    'event: ping\n',
    'data: not-json\n\n',
    'data: {"ok":true}'
  ]);
  assert.deepEqual(await collect(response), [{ ok: true }]);
});

test('streamSSE rejects non-stream responses', async () => {
  await assert.rejects(async () => {
    for await (const _ of streamSSE({ body: null })) void _;
  }, /stream response body is unavailable/);
});
