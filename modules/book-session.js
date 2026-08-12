const LAST_BOOK_KEY = 'wbe-last-book-id';

function getStorage(storage) {
  if (storage) return storage;
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

export function rememberLastBookId(bookId, storage) {
  const s = getStorage(storage);
  if (!s || bookId == null) return;
  s.setItem(LAST_BOOK_KEY, String(bookId));
}

export function readLastBookId(storage) {
  const s = getStorage(storage);
  if (!s) return null;
  const raw = s.getItem(LAST_BOOK_KEY);
  if (raw == null || raw === '') return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export function chooseInitialBookId(books, storage) {
  if (!books || books.length === 0) return null;
  const lastId = readLastBookId(storage);
  if (lastId != null && books.some(b => b.id === lastId)) return lastId;
  return books[0].id;
}
