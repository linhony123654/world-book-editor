import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
let chat = fs.readFileSync(chatPath, 'utf8');

const repositoryImport = "import { createAiDataRepository } from './ai/session/repository.js';\n";
const migrationImport = "import { createLegacyAiDataMigration } from './ai/session/migration.js';\n";
if (!chat.includes(migrationImport)) {
  if (!chat.includes(repositoryImport)) throw new Error('repository import anchor missing');
  chat = chat.replace(repositoryImport, repositoryImport + migrationImport);
}

chat = chat.replace("function memKey(bookId) { return 'wbe-memory:' + (bookId || 'unsaved'); }\n\n", '');
chat = chat.replace("function sessionsKey(bookId) { return 'wbe-sessions:' + (bookId || 'unsaved'); }\nfunction activeKey(bookId) { return 'wbe-active-session:' + (bookId || 'unsaved'); }\n\n", '');
chat = chat.replace("function persistFetch(bookId) {\n  return aiDataRepository.read(bookId);\n}\n\n", '');

const backupStart = chat.indexOf('// 把损坏的本地数据备份到 wbe-corrupt-backup');
const saveMemoryStart = chat.indexOf('function saveMemory() {', backupStart);
if (backupStart < 0 || saveMemoryStart < 0) throw new Error('legacy corrupt backup block boundary missing');
chat = chat.slice(0, backupStart) + chat.slice(saveMemoryStart);

const persistPutEnd = `function persistPut(bookId, payload) {\n  return aiDataRepository.write(bookId, payload);\n}\n`;
const migrationService = `function reportLegacyMigrationWarning(code, error, meta = {}) {
  if (code === 'session_remote_load_failed') {
    console.warn('[WBE] 会话历史加载失败:', error.message);
  } else if (code === 'sessions_local_corrupt') {
    console.warn('[WBE] 会话历史数据损坏，已重置:', meta.key, error);
  } else if (code === 'legacy_chat_corrupt') {
    console.warn('[WBE] 旧版会话历史损坏，跳过迁移:', error.message);
  } else if (code === 'memory_remote_migration_failed') {
    console.warn('[WBE] 书级记忆迁移(后端)失败:', error.message);
  } else if (code === 'memory_local_migration_failed') {
    console.warn('[WBE] 书级记忆迁移(localStorage)失败:', error.message);
  } else if (code === 'corrupt_backup_failed') {
    console.warn('[WBE] 备份损坏数据失败:', meta.key, error);
  }
}

const legacyAiDataMigration = createLegacyAiDataMigration({
  storage: localStorage,
  repository: aiDataRepository,
  makeSession,
  titleFromMessages,
  normalizeMemory,
  emptyMemory,
  onWarning: reportLegacyMigrationWarning,
  onCorruptSessions: () => {
    import('./utils.js').then(m => m.showToast('会话历史数据损坏，已备份并重置', 'error'));
  }
});
`;
if (!chat.includes(persistPutEnd)) throw new Error('persistPut anchor missing');
if (!chat.includes('const legacyAiDataMigration = createLegacyAiDataMigration')) {
  chat = chat.replace(persistPutEnd, persistPutEnd + '\n' + migrationService + '\n');
}

const loadStart = chat.indexOf('async function loadChatHistory(bookId) {');
const saveHistoryStart = chat.indexOf('function saveChatHistory() {', loadStart);
if (loadStart < 0 || saveHistoryStart < 0) throw new Error('loadChatHistory/migrateLegacyMemory boundary missing');
const newLoad = `async function loadChatHistory(bookId) {
  const seed = await legacyAiDataMigration.loadSessionSeed(bookId);
  sessions = normalizeSessionList(seed.sessions);
  const target = selectActiveSession(sessions, seed.activeSession);
  activeSessionId = target ? target.id : null;
  chatMessages.length = 0;
  if (target) {
    chatMessages.push(...visibleMessagesFromSession(target));
    // 会话级记忆：若该会话还没有记忆，迁移旧的「书级记忆」到该会话。
    if (!target.memory) {
      target.memory = await legacyAiDataMigration.migrateLegacyMemory(bookId);
    }
    memory = normalizeMemory(target.memory);
  } else {
    memory = emptyMemory();
  }
  updateMemoryBadge();
}

`;
chat = chat.slice(0, loadStart) + newLoad + chat.slice(saveHistoryStart);

const cleanupOld = `function cleanupDeletedBookLocalData(bookId) {
  localStorage.removeItem(memKey(bookId));
  localStorage.removeItem(sessionsKey(bookId));
  localStorage.removeItem(activeKey(bookId));
  localStorage.removeItem('wbe-chat:' + bookId);
}`;
const cleanupNew = `function cleanupDeletedBookLocalData(bookId) {
  legacyAiDataMigration.cleanupBookLocalData(bookId);
}`;
if (!chat.includes(cleanupOld)) throw new Error('deleted-book local cleanup block missing');
chat = chat.replace(cleanupOld, cleanupNew);

const forbidden = [
  'function memKey(', 'function sessionsKey(', 'function activeKey(',
  'function backupCorruptData(', 'function persistFetch(', 'async function migrateLegacyMemory(',
  "localStorage.getItem('wbe-corrupt-backup')", "localStorage.getItem('wbe-chat:'"
];
for (const token of forbidden) {
  if (chat.includes(token)) throw new Error('legacy session migration concern remains in chat.js: ' + token);
}
if (!chat.includes('legacyAiDataMigration.loadSessionSeed(bookId)')) throw new Error('session seed delegation missing');
if (!chat.includes('legacyAiDataMigration.migrateLegacyMemory(bookId)')) throw new Error('memory migration delegation missing');
if (!chat.includes('legacyAiDataMigration.cleanupBookLocalData(bookId)')) throw new Error('cleanup delegation missing');

fs.writeFileSync(chatPath, chat);

fs.writeFileSync('tests/chat-session-migration-boundary.test.mjs', `import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates legacy session and memory migration to migration service', () => {
  assert.match(chat, /from '\\.\\/ai\\/session\\/migration\\.js'/);
  assert.match(chat, /createLegacyAiDataMigration\\s*\\(/);
  assert.match(chat, /legacyAiDataMigration\\.loadSessionSeed\\(bookId\\)/);
  assert.match(chat, /legacyAiDataMigration\\.migrateLegacyMemory\\(bookId\\)/);
  assert.match(chat, /legacyAiDataMigration\\.cleanupBookLocalData\\(bookId\\)/);
});

test('chat no longer owns legacy key formats, corrupt backup, or fallback parsing', () => {
  assert.doesNotMatch(chat, /function memKey\\s*\\(/);
  assert.doesNotMatch(chat, /function sessionsKey\\s*\\(/);
  assert.doesNotMatch(chat, /function activeKey\\s*\\(/);
  assert.doesNotMatch(chat, /function backupCorruptData\\s*\\(/);
  assert.doesNotMatch(chat, /async function migrateLegacyMemory\\s*\\(/);
  assert.doesNotMatch(chat, /wbe-corrupt-backup/);
  assert.doesNotMatch(chat, /localStorage\\.getItem\\(\\s*['\"]wbe-chat:/);
});
`);

console.log('Migrated legacy session/memory compatibility storage out of chat.js');
