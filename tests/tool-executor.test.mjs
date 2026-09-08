import assert from 'node:assert/strict';
import test from 'node:test';

import { createSafeToolExecutor, createToolExecutor } from '../public/modules/ai/tools/executor.js';

test('tool executor dispatches sync and async handlers with default args', async () => {
  const execute = createToolExecutor({
    handlers: {
      sync: args => ({ summary: 'sync', detail: String(args.value ?? 'none') }),
      async: async args => ({ summary: 'async', detail: String(args.value) })
    }
  });

  assert.deepEqual(await execute('sync'), { summary: 'sync', detail: 'none' });
  assert.deepEqual(await execute('async', { value: 7 }), { summary: 'async', detail: '7' });
});

test('tool executor returns the legacy unknown-tool result', async () => {
  const execute = createToolExecutor();
  assert.deepEqual(await execute('missing_tool', {}), {
    summary: '未知工具',
    detail: 'Unknown tool: missing_tool'
  });
});

test('safe executor establishes mutation boundary before execution', async () => {
  const order = [];
  const safe = createSafeToolExecutor({
    executeTool: async () => { order.push('execute'); return { summary: 'ok', detail: '' }; },
    isMutating: name => name === 'write',
    beforeMutation: async () => { order.push('snapshot'); }
  });

  await safe('write', {});
  assert.deepEqual(order, ['snapshot', 'execute']);
});

test('safe executor does not establish mutation boundary for read-only tools', async () => {
  let snapshots = 0;
  const safe = createSafeToolExecutor({
    executeTool: async () => ({ summary: 'ok', detail: '' }),
    isMutating: () => false,
    beforeMutation: () => { snapshots++; }
  });

  await safe('search_entries', {});
  assert.equal(snapshots, 0);
});

test('safe executor isolates tool errors and reports them to observer', async () => {
  const seen = [];
  const safe = createSafeToolExecutor({
    executeTool: async () => { throw new Error('boom'); },
    onError: (error, name) => seen.push([name, error.message])
  });

  assert.deepEqual(await safe('edit_entry', {}), {
    summary: 'edit_entry 执行失败',
    detail: '工具 edit_entry 执行出错: boom'
  });
  assert.deepEqual(seen, [['edit_entry', 'boom']]);
});

test('errors in beforeMutation stay outside tool-level isolation', async () => {
  const safe = createSafeToolExecutor({
    executeTool: async () => ({ summary: 'never', detail: '' }),
    isMutating: () => true,
    beforeMutation: () => { throw new Error('snapshot failed'); }
  });

  await assert.rejects(() => safe('edit_entry', {}), /snapshot failed/);
});
