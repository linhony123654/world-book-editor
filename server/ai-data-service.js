const EMPTY_AI_DATA = Object.freeze({ memory: null, sessions: null, activeSession: null });

function isValidBookId(bookId) {
  return /^\d+$/.test(String(bookId ?? ''));
}

function parseJsonOrNull(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function createAiDataService({ db } = {}) {
  if (!db) throw new TypeError('AI data service requires db');

  function get(bookId) {
    if (!isValidBookId(bookId)) return { ...EMPTY_AI_DATA };
    const row = db.prepare('SELECT memory, sessions, active_session FROM ai_data WHERE book_id = ?').get(Number(bookId));
    if (!row) return { ...EMPTY_AI_DATA };
    return {
      memory: parseJsonOrNull(row.memory),
      sessions: parseJsonOrNull(row.sessions),
      activeSession: row.active_session || null
    };
  }

  function update(bookId, body = {}) {
    if (!isValidBookId(bookId)) return { error: 'invalid_book_id' };
    const numericBookId = Number(bookId);
    const keys = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, 'memory')) {
      keys.push('memory');
      values.push(body.memory == null ? null : JSON.stringify(body.memory));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'sessions')) {
      keys.push('sessions');
      values.push(body.sessions == null ? null : JSON.stringify(body.sessions));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'activeSession')) {
      keys.push('active_session');
      values.push(body.activeSession == null ? null : String(body.activeSession));
    }
    if (!keys.length) return { error: 'no_fields' };

    keys.push('updated_at');
    const placeholders = keys.map(key => key === 'updated_at' ? "datetime('now')" : '?');
    const updates = keys.map(key => key === 'updated_at' ? 'updated_at = excluded.updated_at' : key + ' = excluded.' + key).join(', ');
    db.prepare(`INSERT INTO ai_data (book_id, ${keys.join(', ')}) VALUES (?, ${placeholders.join(', ')}) ON CONFLICT(book_id) DO UPDATE SET ${updates}`)
      .run(numericBookId, ...values);
    return { ok: true };
  }

  return { get, update };
}

module.exports = {
  EMPTY_AI_DATA,
  createAiDataService,
  isValidBookId,
  parseJsonOrNull
};
