import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseInitialBookId, readLastBookId, rememberLastBookId } from '../modules/book-session.js';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
}

test('remembers the last successfully opened book id', () => {
  const storage = fakeStorage();

  rememberLastBookId(6, storage);

  assert.equal(readLastBookId(storage), 6);
});

test('chooses the remembered book on startup when it still exists', () => {
  const storage = fakeStorage();
  rememberLastBookId(6, storage);

  const chosen = chooseInitialBookId([
    { id: 23, name: 'latest' },
    { id: 6, name: '女权世界' }
  ], storage);

  assert.equal(chosen, 6);
});

test('falls back to the first book when remembered book no longer exists', () => {
  const storage = fakeStorage();
  rememberLastBookId(999, storage);

  const chosen = chooseInitialBookId([
    { id: 23, name: 'latest' },
    { id: 6, name: '女权世界' }
  ], storage);

  assert.equal(chosen, 23);
});

test('returns null when there are no books', () => {
  const storage = fakeStorage();

  assert.equal(chooseInitialBookId([], storage), null);
});
