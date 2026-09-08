import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates legacy session and memory migration to migration service', () => {
  assert.match(chat, /from '\.\/ai\/session\/migration\.js'/);
  assert.match(chat, /createLegacyAiDataMigration\s*\(/);
  assert.match(chat, /legacyAiDataMigration\.loadSessionSeed\(bookId\)/);
  assert.match(chat, /legacyAiDataMigration\.migrateLegacyMemory\(bookId\)/);
  assert.match(chat, /legacyAiDataMigration\.cleanupBookLocalData\(bookId\)/);
});

test('chat no longer owns legacy key formats, corrupt backup, or fallback parsing', () => {
  assert.doesNotMatch(chat, /function memKey\s*\(/);
  assert.doesNotMatch(chat, /function sessionsKey\s*\(/);
  assert.doesNotMatch(chat, /function activeKey\s*\(/);
  assert.doesNotMatch(chat, /function backupCorruptData\s*\(/);
  assert.doesNotMatch(chat, /async function migrateLegacyMemory\s*\(/);
  assert.doesNotMatch(chat, /wbe-corrupt-backup/);
  assert.doesNotMatch(chat, /localStorage\.getItem\(\s*['"]wbe-chat:/);
});
