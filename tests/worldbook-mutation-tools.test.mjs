import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORLD_BOOK_MUTATION_TOOL_NAMES,
  createWorldBookMutationHandlers,
  normalizeEntryFieldValue
} from '../public/modules/ai/tools/worldbook-mutation.js';

function makeEntry(uid) {
  return {
    uid,
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    disable: false,
    order: 100,
    position: 0,
    extensions: {}
  };
}

function makeHarness(initial = []) {
  const entries = initial.map(entry => ({ ...makeEntry(entry.uid), ...entry }));
  const calls = [];
  let selectedUid = entries[0]?.uid ?? null;
  let next = entries.reduce((max, entry) => Math.max(max, entry.uid), -1) + 1;

  const runCommand = (command, options) => {
    calls.push({ command, options });
    switch (command.type) {
      case 'patch_entry': {
        const entry = entries.find(item => item.uid === command.uid);
        if (!entry) return { changed: false };
        Object.assign(entry, command.patch);
        return { changed: true, affectedUids: [command.uid] };
      }
      case 'set_entry_field': {
        for (const uid of command.uids) {
          const entry = entries.find(item => item.uid === uid);
          if (entry) entry[command.field] = command.value;
        }
        return { changed: true, affectedUids: command.uids };
      }
      case 'create_entry': {
        entries.push(command.entry);
        return { changed: true, createdUids: [command.entry.uid] };
      }
      case 'merge_entries': {
        const createdUids = [];
        for (const source of command.entries) {
          const uid = next++;
          entries.push({ ...source, uid });
          createdUids.push(uid);
        }
        return { changed: true, createdUids };
      }
      case 'delete_entries': {
        const deletedUids = command.uids.filter(uid => entries.some(entry => entry.uid === uid));
        for (const uid of deletedUids) {
          const index = entries.findIndex(entry => entry.uid === uid);
          if (index >= 0) entries.splice(index, 1);
        }
        return { changed: deletedUids.length > 0, deletedUids };
      }
      case 'patch_entries': {
        const affectedUids = [];
        for (const item of command.patches) {
          const entry = entries.find(entry => entry.uid === item.uid);
          if (entry) { Object.assign(entry, item.patch); affectedUids.push(item.uid); }
        }
        return { changed: affectedUids.length > 0, affectedUids };
      }
      case 'duplicate_entry': {
        const source = entries.find(entry => entry.uid === command.sourceUid);
        if (!source) return { changed: false, createdUids: [] };
        const uid = next++;
        entries.push({ ...source, uid });
        return { changed: true, createdUids: [uid] };
      }
      case 'merge_existing_entries': {
        const keep = entries.find(entry => entry.uid === command.keep);
        const deletedUids = command.uids.filter(uid => uid !== command.keep);
        for (const uid of deletedUids) {
          const index = entries.findIndex(entry => entry.uid === uid);
          if (index >= 0) entries.splice(index, 1);
        }
        return { changed: !!keep, keptUid: command.keep, deletedUids };
      }
      case 'split_entry': {
        const index = entries.findIndex(entry => entry.uid === command.sourceUid);
        if (index < 0) return { changed: false, createdUids: [] };
        entries.splice(index, 1);
        const createdUids = command.parts.map(part => {
          const uid = next++;
          entries.push({ ...makeEntry(uid), ...part, uid });
          return uid;
        });
        return { changed: true, createdUids };
      }
      default:
        throw new Error('Unexpected command type in test: ' + command.type);
    }
  };

  const handlers = createWorldBookMutationHandlers({
    getEntries: () => entries,
    getCurrentUid: () => selectedUid,
    nextUid: () => next++,
    createEntry: makeEntry,
    runCommand,
    renderSidebar: () => {},
    renderEditor: () => {},
    renderEditorEmpty: () => {},
    selectEntry: uid => { selectedUid = uid; },
    clearCurrentUid: () => { selectedUid = null; },
    scheduleSave: () => {}
  });

  return { entries, calls, handlers, get selectedUid() { return selectedUid; } };
}

test('mutation registry keeps the legacy mutating tool names', () => {
  assert.deepEqual(WORLD_BOOK_MUTATION_TOOL_NAMES, [
    'edit_entry', 'add_entry', 'add_entries', 'delete_entry', 'delete_entries',
    'batch_edit', 'replace_text', 'manage_keys', 'move_entry', 'toggle_entry',
    'reorder_entry', 'duplicate_entry', 'merge_entries', 'split_entry'
  ]);
});

test('field normalization preserves legacy coercion and allow-list behavior', () => {
  assert.equal(normalizeEntryFieldValue('constant', 1), true);
  assert.equal(normalizeEntryFieldValue('order', '42'), 42);
  assert.deepEqual(normalizeEntryFieldValue('key', 'a，b,c'), ['a', 'b', 'c']);
  assert.equal(normalizeEntryFieldValue('role', null), null);
  assert.equal(normalizeEntryFieldValue('comment', null), undefined);
  assert.equal(normalizeEntryFieldValue('totallyUnknown', 'x'), undefined);
});

test('edit_entry ignores unknown fields and emits one PATCH_ENTRY command', () => {
  const h = makeHarness([{ uid: 1, comment: 'old' }]);
  const result = h.handlers.edit_entry({ uid: 1, fields: { comment: 'new', nope: 123 } });

  assert.equal(result.summary, '已修改 #1 的 comment');
  assert.equal(h.entries[0].comment, 'new');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].command.type, 'patch_entry');
  assert.deepEqual(h.calls[0].command.patch, { comment: 'new' });
});

test('delete_entries accepts filters and clears the selected entry when removed', () => {
  const h = makeHarness([
    { uid: 1, comment: 'keep', disable: false },
    { uid: 2, comment: 'remove', disable: true }
  ]);
  h.handlers.delete_entries({ filter: { disable: true } });

  assert.deepEqual(h.entries.map(entry => entry.uid), [1]);
  assert.equal(h.selectedUid, 1);

  h.handlers.delete_entry({ uid: 1 });
  assert.equal(h.selectedUid, null);
});

test('replace_text keeps literal replacement semantics and returns change metadata', () => {
  const h = makeHarness([{ uid: 4, comment: 'x', content: 'a.b a.b' }]);
  const result = h.handlers.replace_text({ find: 'a.b', replace: '$1', uid: 4 });

  assert.equal(h.entries[0].content, '$1 $1');
  assert.equal(result.summary, '已替换 2 处，影响 1 条');
  assert.equal(result.changes[0].uid, 4);
});

test('merge and split handlers delegate structural changes to commands', () => {
  const h = makeHarness([
    { uid: 1, comment: 'A' },
    { uid: 2, comment: 'B' }
  ]);
  const merged = h.handlers.merge_entries({ uids: [1, 2], keep: 1 });
  assert.match(merged.summary, /已合并 2 条/);
  assert.deepEqual(h.entries.map(entry => entry.uid), [1]);

  const split = h.handlers.split_entry({
    uid: 1,
    parts: [
      { comment: 'A1', content: 'one' },
      { comment: 'A2', content: 'two' }
    ]
  });
  assert.match(split.summary, /已拆分 #1 → 2 条/);
  assert.equal(h.entries.length, 2);
});
