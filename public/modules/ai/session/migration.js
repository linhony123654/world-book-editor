// Legacy AI session/memory migration boundary.
// Owns only compatibility storage formats and corrupt-data preservation;
// live session selection/rendering remains in the chat controller.

export const CORRUPT_BACKUP_KEY = 'wbe-corrupt-backup';

function bookKeyPart(bookId) {
  return bookId || 'unsaved';
}

export function sessionsStorageKey(bookId) {
  return 'wbe-sessions:' + bookKeyPart(bookId);
}

export function activeSessionStorageKey(bookId) {
  return 'wbe-active-session:' + bookKeyPart(bookId);
}

export function legacyChatStorageKey(bookId) {
  return 'wbe-chat:' + bookKeyPart(bookId);
}

export function legacyMemoryStorageKey(bookId) {
  return 'wbe-memory:' + bookKeyPart(bookId);
}

export function backupCorruptData(storage, key, raw, { onWarning = () => {} } = {}) {
  try {
    if (raw == null) return false;
    let backups = {};
    try {
      const old = JSON.parse(storage.getItem(CORRUPT_BACKUP_KEY) || '{}');
      if (old && typeof old === 'object') backups = old;
    } catch {}
    backups[key] = String(raw).slice(0, 500000);
    storage.setItem(CORRUPT_BACKUP_KEY, JSON.stringify(backups));
    return true;
  } catch (error) {
    onWarning('corrupt_backup_failed', error, { key });
    return false;
  }
}

export function createLegacyAiDataMigration({
  storage,
  repository,
  makeSession,
  titleFromMessages,
  normalizeMemory,
  emptyMemory,
  onWarning = () => {},
  onCorruptSessions = () => {}
} = {}) {
  if (!storage) throw new TypeError('storage is required');
  if (!repository || typeof repository.read !== 'function' || typeof repository.write !== 'function') {
    throw new TypeError('repository.read/write are required');
  }
  if (typeof makeSession !== 'function' || typeof titleFromMessages !== 'function') {
    throw new TypeError('session migration helpers are required');
  }
  if (typeof normalizeMemory !== 'function' || typeof emptyMemory !== 'function') {
    throw new TypeError('memory migration helpers are required');
  }

  async function loadSessionSeed(bookId) {
    let data = null;
    try {
      data = await repository.read(bookId);
    } catch (error) {
      onWarning('session_remote_load_failed', error, { bookId });
    }

    let sessions = data && Array.isArray(data.sessions) ? data.sessions : null;
    let activeSession = data ? data.activeSession : null;
    if (sessions) return { sessions, activeSession, source: 'remote' };

    const sessionKey = sessionsStorageKey(bookId);
    let raw = null;
    try { raw = storage.getItem(sessionKey); } catch {}
    let local = null;
    try {
      local = raw ? JSON.parse(raw) : null;
    } catch (error) {
      onWarning('sessions_local_corrupt', error, { bookId, key: sessionKey });
      backupCorruptData(storage, sessionKey, raw, { onWarning });
      onCorruptSessions({ bookId, key: sessionKey, error });
    }

    if (!Array.isArray(local)) {
      let old = [];
      try {
        const oldRaw = storage.getItem(legacyChatStorageKey(bookId));
        if (oldRaw) old = JSON.parse(oldRaw);
      } catch (error) {
        onWarning('legacy_chat_corrupt', error, { bookId });
      }
      local = [];
      if (Array.isArray(old) && old.length) {
        const session = makeSession();
        session.messages = old;
        session.title = titleFromMessages(old);
        local.push(session);
      }
    }

    if (local.length) {
      sessions = local;
      activeSession = storage.getItem(activeSessionStorageKey(bookId)) || null;
      // Preserve legacy behavior: enqueue the migration write but do not block loading.
      repository.write(bookId, { sessions, activeSession });
    }

    try {
      storage.removeItem(sessionKey);
      storage.removeItem(activeSessionStorageKey(bookId));
      storage.removeItem(legacyChatStorageKey(bookId));
    } catch {}

    return { sessions, activeSession, source: local.length ? 'local' : 'empty' };
  }

  async function migrateLegacyMemory(bookId) {
    try {
      const data = await repository.read(bookId);
      if (data && data.memory) {
        // Preserve legacy behavior: clear the old book-level slot asynchronously.
        repository.write(bookId, { memory: null });
        return normalizeMemory(data.memory);
      }
    } catch (error) {
      onWarning('memory_remote_migration_failed', error, { bookId });
    }

    try {
      const key = legacyMemoryStorageKey(bookId);
      const raw = storage.getItem(key);
      if (raw) {
        const memory = JSON.parse(raw);
        storage.removeItem(key);
        if (memory && (memory.turns || memory.rollups)) return normalizeMemory(memory);
      }
    } catch (error) {
      onWarning('memory_local_migration_failed', error, { bookId });
    }
    return emptyMemory();
  }

  function cleanupBookLocalData(bookId) {
    storage.removeItem(legacyMemoryStorageKey(bookId));
    storage.removeItem(sessionsStorageKey(bookId));
    storage.removeItem(activeSessionStorageKey(bookId));
    storage.removeItem(legacyChatStorageKey(bookId));
  }

  return {
    loadSessionSeed,
    migrateLegacyMemory,
    cleanupBookLocalData
  };
}
