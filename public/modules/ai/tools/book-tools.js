import { bookInfo as buildBookInfo } from './worldbook-read.js';

export const BOOK_TOOL_NAMES = Object.freeze([
  'get_book_info', 'list_books', 'switch_book', 'create_book', 'rename_book', 'delete_book'
]);

export function resolveBookTarget(books, { id, name, fallbackId } = {}) {
  const list = Array.isArray(books) ? books : [];
  if (id != null) {
    const byId = list.find(book => book.id === id);
    if (byId) return byId;
  }
  if (name) {
    const query = String(name).toLowerCase();
    const exact = list.find(book => String(book.name || '').toLowerCase() === query);
    if (exact) return exact;
    const partial = list.find(book => String(book.name || '').toLowerCase().includes(query));
    if (partial) return partial;
  }
  if (id == null && !name && fallbackId != null) {
    return list.find(book => book.id === fallbackId) || null;
  }
  return null;
}

export function createBookToolHandlers({
  getEntries,
  getCurrentBookId,
  getCurrentBookName,
  getCurrentBookData,
  getOpenEntryCount = () => 0,
  listBooks,
  openBook,
  createBook,
  renameBook,
  deleteBook,
  fetchBook,
  beforeSwitch = () => {},
  setCurrentBookName = () => {},
  cleanupDeletedBook = () => {},
  onCleanupError = () => {},
  onDeletedCurrentBook = async () => ''
} = {}) {
  function currentId() { return getCurrentBookId(); }

  function getBookInfo() {
    return buildBookInfo(getEntries(), {
      name: getCurrentBookName(),
      bookId: currentId()
    });
  }

  async function listBookTool() {
    const books = await listBooks();
    if (!books.length) return { summary: '暂无世界书', detail: '数据库里没有世界书' };
    const detail = books.map(book => {
      const current = book.id === currentId() ? '  ← 当前' : '';
      return '#' + book.id + ' ' + book.name + '（' + book.entry_count + ' 条）' + current;
    }).join('\n');
    return { summary: '共 ' + books.length + ' 本世界书', detail };
  }

  async function switchBook({ id, name } = {}) {
    const books = await listBooks();
    const target = resolveBookTarget(books, { id, name });
    if (!target) {
      return { summary: '未找到目标世界书', detail: '没有匹配 id=' + id + ' / name=' + name + ' 的世界书。可先用 list_books 查看。' };
    }
    if (target.id === currentId()) return { summary: '已在「' + target.name + '」', detail: '当前已是该世界书，无需切换' };
    beforeSwitch('switch');
    await openBook(target.id);
    return {
      summary: '已切换到「' + target.name + '」',
      detail: '已打开世界书 #' + target.id + '（' + target.name + '），现有 ' + getOpenEntryCount() + ' 条'
    };
  }

  async function createBookTool({ name } = {}) {
    const bookName = (name && String(name).trim()) || '新世界书';
    const result = await createBook(bookName);
    beforeSwitch('switch');
    await openBook(result.id);
    return { summary: '已创建并打开「' + bookName + '」', detail: '新世界书 #' + result.id + '（' + bookName + '）已创建并切换过去' };
  }

  async function renameBookTool({ name, id } = {}) {
    const newName = name && String(name).trim();
    if (!newName) return { summary: '缺少新名称', detail: '请提供 name 参数' };
    const targetId = (id != null) ? id : currentId();
    if (targetId == null) return { summary: '无目标世界书', detail: '当前没有打开的世界书，也未指定 id' };
    try {
      if (targetId === currentId()) {
        await renameBook(targetId, newName, getCurrentBookData());
        setCurrentBookName(newName);
      } else {
        const book = await fetchBook(targetId);
        await renameBook(targetId, newName, book);
      }
      return { summary: '已重命名为「' + newName + '」', detail: '世界书 #' + targetId + ' 已重命名为「' + newName + '」' };
    } catch (error) {
      return { summary: '重命名失败', detail: error.message };
    }
  }

  async function deleteBookTool({ id, name, confirm } = {}) {
    const books = await listBooks();
    const target = resolveBookTarget(books, { id, name, fallbackId: currentId() });
    if (!target) {
      return { summary: '未找到目标世界书', detail: '没有匹配 id=' + id + ' / name=' + name + ' 的世界书。可先用 list_books 查看。' };
    }
    if (confirm !== true) {
      return {
        summary: '需确认删除「' + target.name + '」',
        detail: '将永久删除世界书 #' + target.id + '（' + target.name + '），不可恢复。确认请再次调用 delete_book 并传 confirm:true。'
      };
    }

    const wasCurrent = target.id === currentId();
    try {
      await deleteBook(target.id);
    } catch (error) {
      return { summary: '删除失败', detail: error.message };
    }

    try {
      await cleanupDeletedBook(target.id);
    } catch (error) {
      onCleanupError(error, target.id);
    }

    let tail = '';
    if (wasCurrent) {
      const remainingBooks = await listBooks();
      tail = await onDeletedCurrentBook({ deletedBook: target, remainingBooks }) || '';
    }
    return {
      summary: '已删除「' + target.name + '」',
      detail: '世界书 #' + target.id + '（' + target.name + '）已永久删除' + tail
    };
  }

  return {
    get_book_info: getBookInfo,
    list_books: listBookTool,
    switch_book: switchBook,
    create_book: createBookTool,
    rename_book: renameBookTool,
    delete_book: deleteBookTool
  };
}
