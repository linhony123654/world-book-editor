import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

const importLine = "import { applyEntryFilter as filterEntries, searchEntries, getEntry, listEntries, findDuplicates, checkEntries, testTriggers, bookInfo as buildBookInfo } from './ai/tools/worldbook-read.js';\n";
if (!src.includes(importLine.trim())) {
  const anchor = "import { formatChatText } from './ai/ui/markdown.js';\n";
  if (!src.includes(anchor)) throw new Error('markdown import anchor missing');
  src = src.replace(anchor, anchor + importLine);
}

function replaceBetween(startMarker, endMarker, replacement) {
  const start = src.indexOf(startMarker);
  if (start < 0) {
    if (src.includes(replacement.trim())) return;
    throw new Error('start marker missing: ' + startMarker);
  }
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error('end marker missing: ' + endMarker);
  src = src.slice(0, start) + replacement.trimEnd() + '\n\n' + src.slice(end);
}

replaceBetween(
  'function toolSearch({ query, filter, type, includeContent }) {',
  'function toolGet({ uid }) {',
  `function toolSearch(args) {
  return searchEntries(getAllEntries(), args || {});
}`
);

replaceBetween(
  'function toolGet({ uid }) {',
  '// 条目字段白名单（与 state.js createEntry 的字段一致）：AI 只能写这些字段，防止任意字段污染数据结构',
  `function toolGet(args) {
  return getEntry(getAllEntries(), args || {});
}`
);

replaceBetween(
  'function applyEntryFilter(list, filter) {',
  'function toolDeleteMany({ uids, filter }) {',
  `function applyEntryFilter(list, filter) {
  return filterEntries(list, filter);
}`
);

replaceBetween(
  'function toolList({ filter, limit } = {}) {',
  'function toolToggle({ uid, disable }) {',
  `function toolList(args = {}) {
  return listEntries(getAllEntries(), args);
}`
);

replaceBetween(
  'function toolFindDuplicates({ limit } = {}) {',
  '// ===== 全书体检 =====',
  `function toolFindDuplicates(args = {}) {
  return findDuplicates(getAllEntries(), args);
}`
);

// There are two consecutive legacy section comments in some revisions; start from the algorithm marker.
replaceBetween(
  '// 内容相似度：字符 bigram Jaccard，用于区分“真冲突”与“互补共享”',
  '// ===== 触发预演 =====',
  `function toolCheckEntries() {
  return checkEntries(getAllEntries());
}`
);

replaceBetween(
  'function toolTestTriggers({ text }) {',
  '// ===== 导出下载 =====',
  `function toolTestTriggers(args = {}) {
  return testTriggers(getAllEntries(), args);
}`
);

replaceBetween(
  'function toolBookInfo() {',
  'async function toolListBooks() {',
  `function toolBookInfo() {
  return buildBookInfo(getAllEntries(), { name: currentBookName(), bookId: currentBookId });
}`
);

const forbidden = [
  'function contentSimilarity(',
  'const byKey = new Map()',
  '疑似重复条目对',
  '注入顺序（先 depth 后 order）:'
];
for (const token of forbidden) {
  if (src.includes(token)) throw new Error('read-only algorithm remains in chat.js: ' + token);
}
for (const expected of ['searchEntries(', 'findDuplicates(', 'checkEntries(', 'testTriggers(', 'buildBookInfo(']) {
  if (!src.includes(expected)) throw new Error('read-only adapter missing: ' + expected);
}

fs.writeFileSync(path, src);
console.log('read-only worldbook tools extracted');
