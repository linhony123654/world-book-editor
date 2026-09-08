import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
let chat = fs.readFileSync(chatPath, 'utf8');

const searchImport = "import { createWebSearchTool } from './ai/tools/web-search.js';\n";
const bookImport = "import { createBookToolHandlers } from './ai/tools/book-tools.js';\n";
if (!chat.includes(bookImport)) {
  if (!chat.includes(searchImport)) throw new Error('web-search import anchor missing');
  chat = chat.replace(searchImport, searchImport + bookImport);
}

const readImportOld = "import { searchEntries, getEntry, listEntries, findDuplicates, checkEntries, testTriggers, bookInfo as buildBookInfo } from './ai/tools/worldbook-read.js';";
const readImportNew = "import { searchEntries, getEntry, listEntries, findDuplicates, checkEntries, testTriggers } from './ai/tools/worldbook-read.js';";
if (!chat.includes(readImportOld)) throw new Error('worldbook-read bookInfo import shape changed');
chat = chat.replace(readImportOld, readImportNew);

const registryAnchor = 'dispatchTool = createToolExecutor({\n';
const adapterBlock = `const bookToolHandlers = createBookToolHandlers({
  getEntries: getAllEntries,
  getCurrentBookId: () => currentBookId,
  getCurrentBookName: currentBookName,
  getCurrentBookData: () => worldBook,
  getOpenEntryCount: () => entries.length,
  listBooks: loadBookList,
  openBook: id => loadBook(id, renderSidebar, selectEntry, renderEditorEmpty),
  createBook,
  renameBook,
  deleteBook,
  fetchBook: async id => {
    const book = await apiRequest('GET', '/api/books/' + id);
    return book.data;
  },
  beforeSwitch: abortActiveChat,
  setCurrentBookName: name => {
    const el = $('file-name');
    if (el) el.textContent = name;
  },
  cleanupDeletedBook: cleanupDeletedBookLocalData,
  onCleanupError: (error, bookId) => console.warn('[WBE] 清理已删世界书的本地数据失败:', bookId, error),
  onDeletedCurrentBook: handleDeletedCurrentBook
});

`;
if (!chat.includes(registryAnchor)) throw new Error('tool registry anchor missing');
if (!chat.includes('const bookToolHandlers = createBookToolHandlers')) {
  chat = chat.replace(registryAnchor, adapterBlock + registryAnchor);
}

const registrations = [
  '    get_book_info: () => toolBookInfo(),\n',
  '    list_books: () => toolListBooks(),\n',
  '    switch_book: toolSwitchBook,\n',
  '    create_book: toolCreateBook,\n',
  '    rename_book: toolRenameBook,\n',
  '    delete_book: toolDeleteBook\n'
];
for (const line of registrations) {
  if (!chat.includes(line)) throw new Error('legacy book registry line missing: ' + line.trim());
  chat = chat.replace(line, '');
}
const undoAnchor = '    undo_last: toolUndo,\n';
if (!chat.includes(undoAnchor)) throw new Error('undo registry anchor missing');
chat = chat.replace(undoAnchor, undoAnchor + '    ...bookToolHandlers\n');

const tailStart = chat.indexOf('function toolBookInfo() {');
if (tailStart < 0) throw new Error('toolBookInfo block missing');
const lifecycleTail = `function cleanupDeletedBookLocalData(bookId) {
  localStorage.removeItem(memKey(bookId));
  localStorage.removeItem(sessionsKey(bookId));
  localStorage.removeItem(activeKey(bookId));
  localStorage.removeItem('wbe-chat:' + bookId);
}

async function handleDeletedCurrentBook({ remainingBooks }) {
  abortActiveChat('switch');
  memory = emptyMemory();
  logBookId = null;
  sessions = [];
  activeSessionId = null;
  updateMemoryBadge();

  let tail = '';
  if (remainingBooks.length) {
    await loadBook(remainingBooks[0].id, renderSidebar, selectEntry, renderEditorEmpty);
    tail = '，已切换到「' + remainingBooks[0].name + '」';
  } else {
    const state = await import('./state.js');
    state.setCurrentBookId(null);
    state.setCurrentUid(null);
    setEntries([]);
    renderSidebar();
    renderEditorEmpty();
    const el = $('file-name');
    if (el) el.textContent = '未命名';
    chatMessages.length = 0;
    renderChatHistory();
    tail = '，已无其它世界书';
  }
  ensureMemoryLoaded();
  return tail;
}
`;
chat = chat.slice(0, tailStart) + lifecycleTail;

for (const token of ['function toolBookInfo(', 'function toolListBooks(', 'function toolSwitchBook(', 'function toolCreateBook(', 'function toolRenameBook(', 'function toolDeleteBook(']) {
  if (chat.includes(token)) throw new Error('legacy book tool remains: ' + token);
}
if (!chat.includes('...bookToolHandlers')) throw new Error('book handler registry spread missing');
fs.writeFileSync(chatPath, chat);

fs.writeFileSync('tests/chat-book-tools-boundary.test.mjs', `import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates book-level command semantics to the book tool adapter', () => {
  assert.match(chat, /from '\\.\\/ai\\/tools\\/book-tools\\.js'/);
  assert.match(chat, /createBookToolHandlers\\s*\\(/);
  assert.match(chat, /\\.\\.\\.bookToolHandlers/);
  assert.doesNotMatch(chat, /function toolSwitchBook\\s*\\(/);
  assert.doesNotMatch(chat, /function toolDeleteBook\\s*\\(/);
});

test('chat keeps only current-book lifecycle callbacks at the controller boundary', () => {
  assert.match(chat, /function cleanupDeletedBookLocalData\\s*\\(/);
  assert.match(chat, /async function handleDeletedCurrentBook\\s*\\(/);
  assert.match(chat, /onDeletedCurrentBook:\\s*handleDeletedCurrentBook/);
});
`);

console.log('Migrated book-level tool semantics out of chat.js');
