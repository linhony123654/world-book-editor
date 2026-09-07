// ===== World Book domain commands =====
// Pure mutation semantics for entry operations. No DOM, storage, autosave or undo side effects.
// UI/AI callers should go through command-runtime.js instead of mutating worldBook.entries directly.

export const CommandType = Object.freeze({
  CREATE_ENTRY: 'entry.create',
  DELETE_ENTRIES: 'entry.delete-many',
  DUPLICATE_ENTRY: 'entry.duplicate',
  SET_ENTRY_FIELD: 'entry.set-field',
  PATCH_ENTRY: 'entry.patch',
  PATCH_ENTRIES: 'entries.patch-many',
  ADD_KEYWORD: 'entry.keyword-add',
  REMOVE_KEYWORD: 'entry.keyword-remove',
  MERGE_ENTRIES: 'entries.merge',
  MERGE_EXISTING_ENTRIES: 'entries.merge-existing',
  SPLIT_ENTRY: 'entry.split'
});

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
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

function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function patchWouldChange(entry, patch) {
  return !!entry && !!patch && typeof patch === 'object' &&
    Object.entries(patch).some(([field, value]) => !sameValue(entry[field], value));
}

function normalizedPatchList(command) {
  return (Array.isArray(command && command.patches) ? command.patches : [])
    .filter(item => item && Number.isFinite(Number(item.uid)) && item.patch && typeof item.patch === 'object')
    .map(item => ({ uid: Number(item.uid), patch: item.patch }));
}

function mergeExistingPlan(book, command) {
  const targets = normalizeUids(command && command.uids)
    .map(uid => findEntry(book, uid))
    .filter(Boolean);
  if (targets.length < 2) return null;
  const requestedKeep = Number(command && command.keep);
  const keepTarget = Number.isFinite(requestedKeep) && targets.some(t => Number(t.uid) === requestedKeep)
    ? targets.find(t => Number(t.uid) === requestedKeep)
    : targets[0];
  const rest = targets.filter(t => t !== keepTarget);
  return { targets, keepTarget, rest };
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
    case CommandType.SET_ENTRY_FIELD:
      return normalizeUids(command.uids).some(uid => {
        const entry = findEntry(book, uid);
        return entry && !sameValue(entry[command.field], command.value);
      });
    case CommandType.PATCH_ENTRY:
      return patchWouldChange(findEntry(book, command.uid), command.patch);
    case CommandType.PATCH_ENTRIES:
      return normalizedPatchList(command).some(item => patchWouldChange(findEntry(book, item.uid), item.patch));
    case CommandType.ADD_KEYWORD: {
      const entry = findEntry(book, command.uid);
      if (!entry || !command.value) return false;
      const field = command.field || 'key';
      const list = Array.isArray(entry[field]) ? entry[field] : [];
      return !list.includes(command.value);
    }
    case CommandType.REMOVE_KEYWORD: {
      const entry = findEntry(book, command.uid);
      if (!entry || !command.value) return false;
      const field = command.field || 'key';
      const list = Array.isArray(entry[field]) ? entry[field] : [];
      return list.includes(command.value);
    }
    case CommandType.MERGE_ENTRIES: {
      const incoming = Array.isArray(command.entries) ? command.entries : [];
      if (!command.skipDuplicates) return incoming.length > 0;
      const existing = entriesOf(book);
      return incoming.some(entry => !isDuplicateEntry(existing, entry));
    }
    case CommandType.MERGE_EXISTING_ENTRIES:
      return !!mergeExistingPlan(book, command);
    case CommandType.SPLIT_ENTRY: {
      const source = findEntry(book, command.sourceUid);
      const parts = Array.isArray(command.parts) ? command.parts.filter(Boolean) : [];
      return !!source && parts.length >= 2;
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
    skipped: 0,
    keptUid: null
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
        if (!entry || sameValue(entry[command.field], command.value)) continue;
        entry[command.field] = clone(command.value);
        result.affectedUids.push(entry.uid);
      }
      result.changed = result.affectedUids.length > 0;
      return result;
    }

    case CommandType.PATCH_ENTRY: {
      const entry = findEntry(book, command.uid);
      const patch = command.patch && typeof command.patch === 'object' ? command.patch : null;
      if (!entry || !patch) return result;
      let changed = false;
      for (const [field, value] of Object.entries(patch)) {
        if (sameValue(entry[field], value)) continue;
        entry[field] = clone(value);
        changed = true;
      }
      result.changed = changed;
      if (changed) result.affectedUids = [entry.uid];
      return result;
    }

    case CommandType.PATCH_ENTRIES: {
      for (const item of normalizedPatchList(command)) {
        const entry = findEntry(book, item.uid);
        if (!entry) continue;
        let changed = false;
        for (const [field, value] of Object.entries(item.patch)) {
          if (sameValue(entry[field], value)) continue;
          entry[field] = clone(value);
          changed = true;
        }
        if (changed) result.affectedUids.push(entry.uid);
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

    case CommandType.MERGE_EXISTING_ENTRIES: {
      const plan = mergeExistingPlan(book, command);
      if (!plan) return result;
      const { targets, keepTarget, rest } = plan;
      const contentParts = [];
      for (const entry of targets) {
        const content = String(entry.content || '').trim();
        if (content && !contentParts.includes(content)) contentParts.push(content);
      }
      const keySet = new Set((Array.isArray(keepTarget.key) ? keepTarget.key : []).map(String));
      for (const entry of rest) {
        for (const key of (Array.isArray(entry.key) ? entry.key : [])) keySet.add(String(key));
      }
      keepTarget.content = contentParts.join('\n\n');
      keepTarget.key = [...keySet];
      keepTarget.comment = keepTarget.comment || (rest[0] && rest[0].comment) || '合并条目';
      for (const entry of rest) {
        delete book.entries[keyOf(entry.uid)];
        result.deletedUids.push(entry.uid);
      }
      result.changed = true;
      result.structural = true;
      result.keptUid = keepTarget.uid;
      result.affectedUids = [keepTarget.uid, ...result.deletedUids];
      return result;
    }

    case CommandType.SPLIT_ENTRY: {
      const source = findEntry(book, command.sourceUid);
      const parts = (Array.isArray(command.parts) ? command.parts : [])
        .filter(part => part && String(part.comment || '').trim() && String(part.content || '').trim());
      if (!source || parts.length < 2) return result;
      delete book.entries[keyOf(source.uid)];
      result.deletedUids = [source.uid];
      let uid = nextUidFor(book);
      for (const part of parts) {
        const copy = clone(source);
        copy.uid = uid++;
        copy.comment = String(part.comment).trim();
        copy.content = String(part.content).trim();
        if (Array.isArray(part.key)) copy.key = part.key.map(String);
        book.entries[keyOf(copy.uid)] = copy;
        result.createdUids.push(copy.uid);
      }
      result.changed = true;
      result.structural = true;
      result.affectedUids = [source.uid, ...result.createdUids];
      return result;
    }

    default:
      throw new Error('unknown world-book command: ' + command.type);
  }
}
