import assert from 'node:assert/strict';
import test from 'node:test';

import { BOOK_TOOL_NAMES, createBookToolHandlers, resolveBookTarget } from '../public/modules/ai/tools/book-tools.js';

const books = [
  { id: 1, name: 'Alpha', entry_count: 2 },
  { id: 2, name: 'Beta World', entry_count: 7 }
];

test('book tool registry is explicit and stable', () => {
  assert.deepEqual(BOOK_TOOL_NAMES, [
    'get_book_info', 'list_books', 'switch_book', 'create_book', 'rename_book', 'delete_book'
  ]);
});

test('resolveBookTarget preserves id, exact-name, partial-name and fallback order', () => {
  assert.equal(resolveBookTarget(books, { id: 2 }).id, 2);
  assert.equal(resolveBookTarget(books, { name: 'beta world' }).id, 2);
  assert.equal(resolveBookTarget(books, { name: 'beta' }).id, 2);
  assert.equal(resolveBookTarget(books, { fallbackId: 1 }).id, 1);
  assert.equal(resolveBookTarget(books, { id: 99, fallbackId: 1 }), null);
});

function makeHarness() {
  let currentBookId = 1;
  let currentBookName = 'Alpha';
  let currentBookData = { entries: {} };
  let openCount = 2;
  const calls = [];

  const handlers = createBookToolHandlers({
    getEntries: () => [{ uid: 1, disable: false }, { uid: 2, disable: true }],
    getCurrentBookId: () => currentBookId,
    getCurrentBookName: () => currentBookName,
    getCurrentBookData: () => currentBookData,
    getOpenEntryCount: () => openCount,
    listBooks: async () => books.map(book => ({ ...book })),
    openBook: async id => { calls.push(['open', id]); currentBookId = id; currentBookName = books.find(b => b.id === id)?.name || currentBookName; openCount = books.find(b => b.id === id)?.entry_count || 0; },
    createBook: async name => { calls.push(['create', name]); return { id: 9 }; },
    renameBook: async (id, name, data) => { calls.push(['rename', id, name, data]); },
    deleteBook: async id => { calls.push(['delete', id]); },
    fetchBook: async id => { calls.push(['fetch', id]); return { id, entries: { x: {} } }; },
    beforeSwitch: reason => calls.push(['beforeSwitch', reason]),
    setCurrentBookName: name => { currentBookName = name; },
    cleanupDeletedBook: id => calls.push(['cleanup', id]),
    onDeletedCurrentBook: async ({ remainingBooks }) => { calls.push(['deletedCurrent', remainingBooks.length]); return '，已切换'; }
  });

  return { handlers, calls, get currentBookName() { return currentBookName; }, set currentBookData(v) { currentBookData = v; } };
}

test('list_books marks the current book and switch_book opens matched targets', async () => {
  const h = makeHarness();
  const listed = await h.handlers.list_books();
  assert.match(listed.detail, /#1 Alpha（2 条）  ← 当前/);

  const switched = await h.handlers.switch_book({ name: 'beta' });
  assert.equal(switched.summary, '已切换到「Beta World」');
  assert.deepEqual(h.calls.slice(-2), [['beforeSwitch', 'switch'], ['open', 2]]);
  assert.match(switched.detail, /现有 7 条/);
});

test('switch_book is a no-op when target is already current', async () => {
  const h = makeHarness();
  const result = await h.handlers.switch_book({ id: 1 });
  assert.equal(result.summary, '已在「Alpha」');
  assert.equal(h.calls.length, 0);
});

test('create_book defaults the name, interrupts, then opens the new id', async () => {
  const h = makeHarness();
  const result = await h.handlers.create_book({ name: '   ' });
  assert.equal(result.summary, '已创建并打开「新世界书」');
  assert.deepEqual(h.calls, [['create', '新世界书'], ['beforeSwitch', 'switch'], ['open', 9]]);
});

test('rename_book uses live current data or fetches non-current data', async () => {
  const h = makeHarness();
  const currentData = { entries: { one: {} } };
  h.currentBookData = currentData;
  const currentResult = await h.handlers.rename_book({ name: 'Renamed' });
  assert.equal(currentResult.summary, '已重命名为「Renamed」');
  assert.equal(h.currentBookName, 'Renamed');
  assert.deepEqual(h.calls[0], ['rename', 1, 'Renamed', currentData]);

  h.calls.length = 0;
  await h.handlers.rename_book({ id: 2, name: 'Other' });
  assert.deepEqual(h.calls[0], ['fetch', 2]);
  assert.deepEqual(h.calls[1], ['rename', 2, 'Other', { id: 2, entries: { x: {} } }]);
});

test('rename_book converts API failures into the legacy tool result', async () => {
  const handlers = createBookToolHandlers({
    getEntries: () => [], getCurrentBookId: () => 1, getCurrentBookName: () => 'A', getCurrentBookData: () => ({}),
    listBooks: async () => books, openBook: async () => {}, createBook: async () => ({ id: 1 }),
    renameBook: async () => { throw new Error('conflict'); }, deleteBook: async () => {}, fetchBook: async () => ({})
  });
  assert.deepEqual(await handlers.rename_book({ name: 'X' }), { summary: '重命名失败', detail: 'conflict' });
});

test('delete_book requires explicit confirmation and cleans per-book state after delete', async () => {
  const h = makeHarness();
  const prompt = await h.handlers.delete_book({ id: 1 });
  assert.match(prompt.summary, /需确认删除/);
  assert.equal(h.calls.length, 0);

  const deleted = await h.handlers.delete_book({ id: 1, confirm: true });
  assert.equal(deleted.summary, '已删除「Alpha」');
  assert.deepEqual(h.calls, [['delete', 1], ['cleanup', 1], ['deletedCurrent', 2]]);
  assert.match(deleted.detail, /，已切换$/);
});

test('delete_book cleanup errors are non-fatal while delete errors are returned', async () => {
  const cleanupErrors = [];
  const base = {
    getEntries: () => [], getCurrentBookId: () => 2, getCurrentBookName: () => 'Beta World', getCurrentBookData: () => ({}),
    listBooks: async () => books, openBook: async () => {}, createBook: async () => ({ id: 1 }), renameBook: async () => {}, fetchBook: async () => ({})
  };
  const handlers = createBookToolHandlers({
    ...base,
    deleteBook: async () => {},
    cleanupDeletedBook: () => { throw new Error('storage'); },
    onCleanupError: error => cleanupErrors.push(error.message),
    onDeletedCurrentBook: async () => ''
  });
  assert.equal((await handlers.delete_book({ id: 1, confirm: true })).summary, '已删除「Alpha」');
  assert.deepEqual(cleanupErrors, ['storage']);

  const failed = createBookToolHandlers({ ...base, deleteBook: async () => { throw new Error('denied'); } });
  assert.deepEqual(await failed.delete_book({ id: 1, confirm: true }), { summary: '删除失败', detail: 'denied' });
});
