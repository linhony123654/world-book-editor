import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
let chat = fs.readFileSync(chatPath, 'utf8');

const executorImport = "import { createSafeToolExecutor, createToolExecutor } from './ai/tools/executor.js';\n";
const mutationImport = "import { WORLD_BOOK_MUTATION_TOOL_NAMES, createWorldBookMutationHandlers } from './ai/tools/worldbook-mutation.js';\n";
if (!chat.includes(mutationImport)) {
  if (!chat.includes(executorImport)) throw new Error('executor import anchor missing');
  chat = chat.replace(executorImport, executorImport + mutationImport);
}

const oldMutatingNames = `const MUTATING_TOOL_NAMES = new Set([
  'edit_entry', 'add_entry', 'add_entries', 'create_smart_entry',
  'delete_entry', 'delete_entries', 'batch_edit', 'replace_text',
  'manage_keys', 'move_entry', 'toggle_entry', 'reorder_entry',
  'duplicate_entry', 'merge_entries', 'split_entry'
]);`;
const newMutatingNames = `const MUTATING_TOOL_NAMES = new Set([
  ...WORLD_BOOK_MUTATION_TOOL_NAMES,
  'create_smart_entry'
]);`;
if (!chat.includes(oldMutatingNames)) throw new Error('legacy MUTATING_TOOL_NAMES declaration missing');
chat = chat.replace(oldMutatingNames, newMutatingNames);

const readImportOld = "import { applyEntryFilter as filterEntries, searchEntries, getEntry, listEntries, findDuplicates, checkEntries, testTriggers, bookInfo as buildBookInfo } from './ai/tools/worldbook-read.js';";
const readImportNew = "import { searchEntries, getEntry, listEntries, findDuplicates, checkEntries, testTriggers, bookInfo as buildBookInfo } from './ai/tools/worldbook-read.js';";
if (!chat.includes(readImportOld)) throw new Error('worldbook-read import shape changed');
chat = chat.replace(readImportOld, readImportNew);

const registryAnchor = 'dispatchTool = createToolExecutor({\n';
const adapterBlock = `const mutationToolHandlers = createWorldBookMutationHandlers({
  getEntries: getAllEntries,
  getCurrentUid: () => currentUid,
  nextUid,
  createEntry,
  runCommand: runWorldBookCommand,
  renderSidebar,
  renderEditor,
  renderEditorEmpty,
  selectEntry,
  clearCurrentUid: () => import('./state.js').then(m => m.setCurrentUid(null)),
  scheduleSave
});

`;
if (!chat.includes(registryAnchor)) throw new Error('tool registry anchor missing');
if (!chat.includes('const mutationToolHandlers = createWorldBookMutationHandlers')) {
  chat = chat.replace(registryAnchor, adapterBlock + registryAnchor);
}

const explicitMutationRegistrations = [
  '    edit_entry: toolEdit,\n',
  '    add_entry: toolAdd,\n',
  '    add_entries: toolAddMany,\n',
  '    delete_entry: toolDelete,\n',
  '    delete_entries: toolDeleteMany,\n',
  '    batch_edit: toolBatchEdit,\n',
  '    replace_text: toolReplaceText,\n',
  '    manage_keys: toolManageKeys,\n',
  '    move_entry: toolMoveEntry,\n',
  '    toggle_entry: toolToggle,\n',
  '    reorder_entry: toolReorder,\n',
  '    duplicate_entry: toolDuplicate,\n',
  '    merge_entries: toolMergeEntries,\n',
  '    split_entry: toolSplitEntry,\n'
];
for (const line of explicitMutationRegistrations) {
  if (!chat.includes(line)) throw new Error('mutation registry line missing: ' + line.trim());
  chat = chat.replace(line, '');
}
const readRegistryAnchor = '    get_entry: toolGet,\n';
if (!chat.includes(readRegistryAnchor)) throw new Error('get_entry registry anchor missing');
chat = chat.replace(readRegistryAnchor, readRegistryAnchor + '    ...mutationToolHandlers,\n');

function removeBetween(startMarker, endMarker, label) {
  const start = chat.indexOf(startMarker);
  if (start < 0) throw new Error(label + ' start marker missing');
  const end = chat.indexOf(endMarker, start);
  if (end < 0) throw new Error(label + ' end marker missing');
  chat = chat.slice(0, start) + chat.slice(end);
}

removeBetween('// 条目字段白名单', 'async function toolCreateSmartEntry(args) {', 'edit/add mutation block');
removeBetween('function toolDelete({ uid }) {', 'function toolList(args = {}) {', 'delete/batch mutation block');
removeBetween('function toolToggle({ uid, disable }) {', '// ===== 查重：', 'toggle/structural mutation block');

const forbidden = [
  'function toolEdit(', 'function toolAdd(', 'function toolAddMany(',
  'function toolDelete(', 'function toolDeleteMany(', 'function toolBatchEdit(',
  'function toolReplaceText(', 'function toolManageKeys(', 'function toolMoveEntry(',
  'function toolToggle(', 'function toolReorder(', 'function toolDuplicate(',
  'function toolMergeEntries(', 'function toolSplitEntry(', 'ENTRY_FIELD_TYPES ='
];
for (const token of forbidden) {
  if (chat.includes(token)) throw new Error('legacy mutation implementation remains: ' + token);
}
if (!chat.includes('...mutationToolHandlers')) throw new Error('mutation handler spread missing');
if (!chat.includes('...WORLD_BOOK_MUTATION_TOOL_NAMES')) throw new Error('mutation-name registry not delegated');

fs.writeFileSync(chatPath, chat);

const boundaryPath = 'tests/chat-command-boundary.test.mjs';
let boundary = fs.readFileSync(boundaryPath, 'utf8');
const oldTest = `test('chat mutating tools use the command boundary', () => {
  assert.match(chat, /from '\\.\\/domain\\/command-runtime\\.js'/);
  assert.match(chat, /CommandType\\.PATCH_ENTRIES/);
  assert.match(chat, /CommandType\\.MERGE_EXISTING_ENTRIES/);
  assert.match(chat, /CommandType\\.SPLIT_ENTRY/);
  assert.doesNotMatch(chat, /worldBook\\.entries\\s*\\[/);
  assert.doesNotMatch(chat, /\\buidKey\\s*\\(/);
});`;
const newTest = `test('chat delegates mutating entry tools to the world-book mutation adapter', () => {
  const mutationPath = new URL('../public/modules/ai/tools/worldbook-mutation.js', import.meta.url);
  const mutation = fs.readFileSync(mutationPath, 'utf8');
  assert.match(chat, /from '\\.\\/ai\\/tools\\/worldbook-mutation\\.js'/);
  assert.match(chat, /createWorldBookMutationHandlers\\s*\\(/);
  assert.match(chat, /\\.\\.\\.mutationToolHandlers/);
  assert.doesNotMatch(chat, /function toolEdit\\s*\\(/);
  assert.doesNotMatch(chat, /function toolDeleteMany\\s*\\(/);
  assert.doesNotMatch(chat, /function toolMergeEntries\\s*\\(/);
  assert.match(mutation, /CommandType\\.PATCH_ENTRIES/);
  assert.match(mutation, /CommandType\\.MERGE_EXISTING_ENTRIES/);
  assert.match(mutation, /CommandType\\.SPLIT_ENTRY/);
  assert.doesNotMatch(chat, /worldBook\\.entries\\s*\\[/);
  assert.doesNotMatch(chat, /\\buidKey\\s*\\(/);
});`;
if (!boundary.includes(oldTest)) throw new Error('chat command-boundary test block missing');
boundary = boundary.replace(oldTest, newTest);
fs.writeFileSync(boundaryPath, boundary);

console.log('Migrated world-book mutation handlers out of chat.js');
