import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CommandType,
  applyWorldBookCommand,
  commandWouldChange,
  entriesOf,
  nextUidFor
} from '../public/modules/domain/worldbook-commands.js';

function bookOf(entries = []) {
  return { entries: Object.fromEntries(entries.map(e => [String(e.uid), structuredClone(e)])) };
}

test('create and duplicate entries preserve uid invariants', () => {
  const book = bookOf([{ uid: 2, comment: 'A', content: 'alpha', key: [] }]);
  assert.equal(nextUidFor(book), 3);

  const create = applyWorldBookCommand(book, {
    type: CommandType.CREATE_ENTRY,
    entry: { uid: 3, comment: 'B', content: 'beta', key: [] }
  });
  assert.equal(create.changed, true);
  assert.deepEqual(create.createdUids, [3]);

  const duplicate = applyWorldBookCommand(book, {
    type: CommandType.DUPLICATE_ENTRY,
    sourceUid: 2
  });
  assert.equal(duplicate.changed, true);
  assert.deepEqual(duplicate.createdUids, [4]);
  assert.equal(book.entries['4'].comment, 'A (副本)');
  assert.equal(book.entries['4'].content, 'alpha');
});

test('set-field and keyword commands are no-op aware', () => {
  const book = bookOf([{ uid: 1, constant: false, key: ['王城'], keysecondary: [] }]);

  assert.equal(commandWouldChange(book, {
    type: CommandType.SET_ENTRY_FIELD,
    uids: [1], field: 'constant', value: false
  }), false);

  const set = applyWorldBookCommand(book, {
    type: CommandType.SET_ENTRY_FIELD,
    uids: [1], field: 'constant', value: true
  });
  assert.equal(set.changed, true);
  assert.equal(book.entries['1'].constant, true);

  const add = applyWorldBookCommand(book, {
    type: CommandType.ADD_KEYWORD,
    uid: 1, field: 'keysecondary', value: '夜禁'
  });
  assert.equal(add.changed, true);
  assert.deepEqual(book.entries['1'].keysecondary, ['夜禁']);

  const duplicateAdd = applyWorldBookCommand(book, {
    type: CommandType.ADD_KEYWORD,
    uid: 1, field: 'keysecondary', value: '夜禁'
  });
  assert.equal(duplicateAdd.changed, false);

  const remove = applyWorldBookCommand(book, {
    type: CommandType.REMOVE_KEYWORD,
    uid: 1, field: 'key', value: '王城'
  });
  assert.equal(remove.changed, true);
  assert.deepEqual(book.entries['1'].key, []);
});

test('delete-many synchronizes structural result metadata', () => {
  const book = bookOf([
    { uid: 1, comment: 'A' },
    { uid: 2, comment: 'B' },
    { uid: 3, comment: 'C' }
  ]);
  const result = applyWorldBookCommand(book, {
    type: CommandType.DELETE_ENTRIES,
    uids: [1, 3, 999]
  });

  assert.equal(result.structural, true);
  assert.deepEqual(result.deletedUids, [1, 3]);
  assert.deepEqual(entriesOf(book).map(e => e.uid), [2]);
});

test('merge reassigns incoming uids and optionally skips duplicates', () => {
  const book = bookOf([{ uid: 5, comment: 'Existing', content: 'same' }]);
  const result = applyWorldBookCommand(book, {
    type: CommandType.MERGE_ENTRIES,
    skipDuplicates: true,
    entries: [
      { uid: 1, comment: 'Existing', content: 'other' },
      { uid: 2, comment: 'New', content: 'new content' }
    ]
  });

  assert.equal(result.skipped, 1);
  assert.deepEqual(result.createdUids, [6]);
  assert.equal(book.entries['6'].comment, 'New');
});

test('patch-many applies one atomic batch without touching unchanged entries', () => {
  const book = bookOf([
    { uid: 1, comment: 'A', content: 'one', constant: false },
    { uid: 2, comment: 'B', content: 'two', constant: false },
    { uid: 3, comment: 'C', content: 'three', constant: true }
  ]);

  const result = applyWorldBookCommand(book, {
    type: CommandType.PATCH_ENTRIES,
    patches: [
      { uid: 1, patch: { content: 'ONE', constant: true } },
      { uid: 2, patch: { content: 'two' } },
      { uid: 999, patch: { content: 'missing' } }
    ]
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.affectedUids, [1]);
  assert.equal(book.entries['1'].content, 'ONE');
  assert.equal(book.entries['1'].constant, true);
  assert.equal(book.entries['2'].content, 'two');
});

test('merge-existing combines content and keyword union atomically', () => {
  const book = bookOf([
    { uid: 4, comment: '王城', content: '第一段', key: ['王城', '城门'] },
    { uid: 7, comment: '王城补充', content: '第二段', key: ['王城', '夜禁'] },
    { uid: 8, comment: '无关', content: '保留', key: ['其他'] }
  ]);

  const result = applyWorldBookCommand(book, {
    type: CommandType.MERGE_EXISTING_ENTRIES,
    uids: [4, 7],
    keep: 4
  });

  assert.equal(result.changed, true);
  assert.equal(result.structural, true);
  assert.equal(result.keptUid, 4);
  assert.deepEqual(result.deletedUids, [7]);
  assert.equal(book.entries['4'].content, '第一段\n\n第二段');
  assert.deepEqual(book.entries['4'].key, ['王城', '城门', '夜禁']);
  assert.equal(book.entries['7'], undefined);
  assert.equal(book.entries['8'].content, '保留');
});

test('split-entry deletes source and allocates sequential new uids', () => {
  const book = bookOf([
    { uid: 3, comment: '大条目', content: '原文', key: ['原词'], order: 100 },
    { uid: 9, comment: '已有', content: '已有内容', key: [] }
  ]);

  const result = applyWorldBookCommand(book, {
    type: CommandType.SPLIT_ENTRY,
    sourceUid: 3,
    parts: [
      { comment: '上篇', content: '上篇正文' },
      { comment: '下篇', content: '下篇正文', key: ['下篇词'] }
    ]
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.deletedUids, [3]);
  assert.deepEqual(result.createdUids, [10, 11]);
  assert.equal(book.entries['3'], undefined);
  assert.equal(book.entries['10'].comment, '上篇');
  assert.deepEqual(book.entries['10'].key, ['原词']);
  assert.deepEqual(book.entries['11'].key, ['下篇词']);
  assert.equal(book.entries['11'].order, 100);
});
