// ===== World Book domain commands =====
// Pure mutation semantics for entry operations. No DOM, storage, autosave or undo side effects.
// UI/AI callers should go through command-runtime.js instead of mutating worldBook.entries directly.

export const CommandType = Object.freeze({
  CREATE_ENTRY: 'entry.create',
  DELETE_ENTRIES: 'entry.delete-many',
  DUPLICATE_ENTRY: 'entry.duplicate',
  SET_ENTRY_FIELD: 'entry.set-field',
  ADD_KEYWORD: 'entry.keyword-add',
  REMOVE_KEYWORD: 'entry.keyword-remove',
  MERGE_ENTRIES: 'entries.merge'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureBook(book) {
  if (!book || typeof book !== 'object') throw new Error('world book is not loaded');
  if (!book.entries || typeof book.entries !== 'object') book.entries = {};
  return book;
}

function keyOf(uid) { return String(uid); }

export function entriesOf(book) {
  ensureBook(book);
  return Object.values(book.entries).sort((a, b) => Number(a.uid || 0) - Number(b.uid || 0));
}

export function nextUidFor(book) {
  const list = entriesOf(book);
  return list.length ? Math.max(...list.map(e => Number(e.uid || 0))) + 1 : 0;
}

function normalizeUids(uids) {
  return [...new Set((Array.isArray(uids) ? uids : [uids])
    .map(Number)
    .filter(Number.isFinite))];
}

function findEntry(book, uid) {
  return ensureBook(book).entries[keyOf(uid)] || entriesOf(book).find(e => Number(e.uid) === Number(uid)) || null;
}

function isDuplicateEntry(existing, incoming) {
  return existing.some(x =>
    (x.comment && x.comment === incoming.comment) ||
    (x.content && incoming.content && incoming.content.trim() && x.content === incoming.content));
}

export function commandWouldChange(book, command) {
  ensureBook(book);
  if (!command || !command.type) return false;

  switch (command.type) {
    case CommandType.CREATE_ENTRY: {
      const entry = command.entry;
      return !!entry && !findEntry(book, entry.uid);
    }
    case CommandType.DELETE_ENTRIES:
      return normalizeUids(command.uids).some(uid => !!findEntry(book, uid));
    case CommandType.DUPLICATE_ENTRY:
      return !!findEntry(book, command.sourceUid);
    case CommandType.SET_ENTRY_FIELD: {
      const uids = normalizeUids(command.uids);
      return uids.some(uid => {
        const entry = findEntry(book, uid);
        return entry && !Object.is(entry[command.field], command.value);
      });
    }
    case CommandType.ADD_KEYWORD: {
      const entry = findEntry(book, command.uid);
      if (!entry || !command.value) return false;
      const list = Array.isArray(entry[command.field]) ? entry[command.field] : [];
      return !list.includes(command.value);
    }
    case CommandType.REMOVE_KEYWORD: {
      const entry = findEntry(book, command.uid);
      if (!entry || !command.value) return false;
      const list = Array.isArray(entry[command.field]) ? entry[command.field] : [];
      return list.includes(command.value);
    }
    case CommandType.MERGE_ENTRIES: {
      const incoming = Array.isArray(command.entries) ? command.entries : [];
      if (!command.skipDuplicates) return incoming.length > 0;
      const existing = entriesOf(book);
      return incoming.some(entry => !isDuplicateEntry(existing, entry));
    }
    default:
      return false;
  }
}

export function applyWorldBookCommand(book, command) {
  ensureBook(book);
  const result = {
    type: command && command.type,
    changed: false,
    structural: false,
    affectedUids: [],
    createdUids: [],
    deletedUids: [],
    skipped: 0
  };
  if (!command || !command.type) return result;

  switch (command.type) {
    case CommandType.CREATE_ENTRY: {
      if (!command.entry || findEntry(book, command.entry.uid)) return result;
      const entry = clone(command.entry);
      book.entries[keyOf(entry.uid)] = entry;
      result.changed = true;
      result.structural = true;
      result.affectedUids = [entry.uid];
      result.createdUids = [entry.uid];
      return result;
    }

    case CommandType.DELETE_ENTRIES: {
      for (const uid of normalizeUids(command.uids)) {
        const entry = findEntry(book, uid);
        if (!entry) continue;
        delete book.entries[keyOf(entry.uid)];
        result.deletedUids.push(entry.uid);
      }
      result.changed = result.deletedUids.length > 0;
      result.structural = result.changed;
      result.affectedUids = result.deletedUids.slice();
      return result;
    }

    case CommandType.DUPLICATE_ENTRY: {
      const source = findEntry(book, command.sourceUid);
      if (!source) return result;
      const uid = Number.isFinite(Number(command.newUid)) ? Number(command.newUid) : nextUidFor(book);
      if (findEntry(book, uid)) throw new Error('duplicate target uid: ' + uid);
      const copy = clone(source);
      copy.uid = uid;
      copy.comment = (copy.comment || '') + (command.titleSuffix == null ? ' (副本)' : String(command.titleSuffix));
      book.entries[keyOf(uid)] = copy;
      result.changed = true;
      result.structural = true;
      result.affectedUids = [source.uid, uid];
      result.createdUids = [uid];
      return result;
    }

    case CommandType.SET_ENTRY_FIELD: {
      for (const uid of normalizeUids(command.uids)) {
        const entry = findEntry(book, uid);
        if (!entry || Object.is(entry[command.field], command.value)) continue;
        entry[command.field] = clone(command.value);
        result.affectedUids.push(entry.uid);
      }
      result.changed = result.affectedUids.length > 0;
      return result;
    }

    case CommandType.ADD_KEYWORD: {
      const entry = findEntry(book, command.uid);
      if (!entry || !command.value) return result;
      const field = command.field || 'key';
      const list = Array.isArray(entry[field]) ? entry[field] : [];
      if (list.includes(command.value)) return result;
      entry[field] = [...list, command.value];
      result.changed = true;
      result.affectedUids = [entry.uid];
      return result;
    }

    case CommandType.REMOVE_KEYWORD: {
      const entry = findEntry(book, command.uid);
      if (!entry || !command.value) return result;
      const field = command.field || 'key';
      const list = Array.isArray(entry[field]) ? entry[field] : [];
      const next = list.filter(x => x !== command.value);
      if (next.length === list.length) return result;
      entry[field] = next;
      result.changed = true;
      result.affectedUids = [entry.uid];
      return result;
    }

    case CommandType.MERGE_ENTRIES: {
      const incoming = (Array.isArray(command.entries) ? command.entries : [])
        .slice()
        .sort((a, b) => Number(a.uid || 0) - Number(b.uid || 0));
      const existing = entriesOf(book);
      let uid = nextUidFor(book);
      for (const source of incoming) {
        if (command.skipDuplicates && isDuplicateEntry(existing, source)) {
          result.skipped++;
          continue;
        }
        const copy = clone(source);
        copy.uid = uid++;
        book.entries[keyOf(copy.uid)] = copy;
        existing.push(copy);
        result.createdUids.push(copy.uid);
      }
      result.changed = result.createdUids.length > 0;
      result.structural = result.changed;
      result.affectedUids = result.createdUids.slice();
      return result;
    }

    default:
      throw new Error('unknown world-book command: ' + command.type);
  }
}
