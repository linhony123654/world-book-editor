import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeBookDiff,
  lineDiff
} from '../public/modules/app/version-history.js';

test('line diff preserves same/add/delete ordering used by version preview', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nx\nc'), [
    { t: 'same', s: 'a' },
    { t: 'del', s: 'b' },
    { t: 'add', s: 'x' },
    { t: 'same', s: 'c' }
  ]);
});

test('book diff separates added, removed and changed entries', () => {
  const oldData = {
    entries: {
      1: { uid: 1, comment: 'Old', content: 'same', key: ['a'], constant: false },
      2: { uid: 2, comment: 'Removed', content: 'gone', key: [] },
      3: { uid: 3, comment: 'Changed', content: 'before', key: ['old'], constant: false }
    }
  };
  const newData = {
    entries: {
      1: { uid: 1, comment: 'Old', content: 'same', key: ['a'], constant: false },
      3: { uid: 3, comment: 'Changed', content: 'after', key: ['new'], constant: true },
      4: { uid: 4, comment: 'Added', content: 'new', key: [] }
    }
  };

  const diff = computeBookDiff(oldData, newData);
  assert.deepEqual(diff.added.map(e => e.uid), [4]);
  assert.deepEqual(diff.removed.map(e => e.uid), [2]);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].uid, '3');
  assert.equal(diff.changed[0].title, 'Changed');
  assert.deepEqual(diff.changed[0].fields.map(f => f.f), ['content', 'constant', 'key']);
});

test('missing keys normalize to empty arrays and do not create a false change', () => {
  const diff = computeBookDiff(
    { entries: { 7: { uid: 7, comment: 'Entry', content: 'x' } } },
    { entries: { 7: { uid: 7, comment: 'Entry', content: 'x', key: [] } } }
  );
  assert.equal(diff.changed.length, 0);
});

test('fallback changed-entry title matches current then old then uid', () => {
  const currentTitle = computeBookDiff(
    { entries: { 1: { content: 'a', comment: 'Old' } } },
    { entries: { 1: { content: 'b', comment: 'New' } } }
  );
  assert.equal(currentTitle.changed[0].title, 'New');

  const oldTitle = computeBookDiff(
    { entries: { 2: { content: 'a', comment: 'Old' } } },
    { entries: { 2: { content: 'b', comment: '' } } }
  );
  assert.equal(oldTitle.changed[0].title, 'Old');

  const uidTitle = computeBookDiff(
    { entries: { 3: { content: 'a' } } },
    { entries: { 3: { content: 'b' } } }
  );
  assert.equal(uidTitle.changed[0].title, '#3');
});
