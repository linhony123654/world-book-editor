import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

const importAnchor = "import { streamFetch, streamSSE } from './ai/transport.js';\n";
const importLine = "import { createSafeToolExecutor, createToolExecutor } from './ai/tools/executor.js';\n";
if (!src.includes(importLine)) {
  if (!src.includes(importAnchor)) throw new Error('transport import anchor missing');
  src = src.replace(importAnchor, importAnchor + importLine);
}

const oldSafe = `async function safeExecuteTool(name, args) {
  // Turn-level rollback is a separate boundary from per-command undo.
  // Read-only tools must not create fake undo history.
  if (turnUndoBase === -1 && MUTATING_TOOL_NAMES.has(name)) {
    snapshotForUndo('AI 回合开始');
    turnUndoBase = undoStackLength();
  }
  try {
    return await executeTool(name, args);
  } catch (e) {
    console.warn('[WBE] 工具执行异常:', name, e);
    return { summary: name + ' 执行失败', detail: '工具 ' + name + ' 执行出错: ' + (e && e.message ? e.message : String(e)) };
  }
}
`;

const newSafe = `let dispatchTool = null;
const safeExecuteTool = createSafeToolExecutor({
  executeTool: (name, args) => dispatchTool(name, args),
  isMutating: name => MUTATING_TOOL_NAMES.has(name),
  beforeMutation: () => {
    // Turn-level rollback is separate from per-command undo. Read-only tools never snapshot.
    if (turnUndoBase === -1) {
      snapshotForUndo('AI 回合开始');
      turnUndoBase = undoStackLength();
    }
  },
  onError: (error, name) => console.warn('[WBE] 工具执行异常:', name, error)
});
`;

if (!src.includes(oldSafe)) throw new Error('legacy safeExecuteTool block missing');
src = src.replace(oldSafe, newSafe);

const startMarker = `async function executeTool(name, args) {\n`;
const start = src.indexOf(startMarker);
if (start < 0) throw new Error('legacy executeTool dispatcher missing');
const endMarker = `\n}\n\n// 统一取全部条目`;
const end = src.indexOf(endMarker, start);
if (end < 0) throw new Error('executeTool dispatcher end missing');

const replacement = `dispatchTool = createToolExecutor({
  handlers: {
    search_entries: toolSearch,
    get_entry: toolGet,
    edit_entry: toolEdit,
    add_entry: toolAdd,
    add_entries: toolAddMany,
    get_writing_template: toolGetWritingTemplate,
    update_writing_template: toolUpdateWritingTemplate,
    plan_smart_entry: toolPlanSmartEntry,
    create_smart_entry: toolCreateSmartEntry,
    delete_entry: toolDelete,
    delete_entries: toolDeleteMany,
    batch_edit: toolBatchEdit,
    replace_text: toolReplaceText,
    manage_keys: toolManageKeys,
    move_entry: toolMoveEntry,
    list_entries: toolList,
    toggle_entry: toolToggle,
    reorder_entry: toolReorder,
    duplicate_entry: toolDuplicate,
    merge_entries: toolMergeEntries,
    split_entry: toolSplitEntry,
    check_entries: () => toolCheckEntries(),
    test_triggers: toolTestTriggers,
    export_book: () => toolExportBook(),
    web_search: toolWebSearch,
    cleanup_book: () => toolCleanupBook(),
    find_duplicates: toolFindDuplicates,
    undo_last: toolUndo,
    get_book_info: () => toolBookInfo(),
    list_books: () => toolListBooks(),
    switch_book: toolSwitchBook,
    create_book: toolCreateBook,
    rename_book: toolRenameBook,
    delete_book: toolDeleteBook
  }
});
`;

src = src.slice(0, start) + replacement + src.slice(end + 2);

if (src.includes('switch (name)')) throw new Error('legacy tool switch still present');
if (src.includes('async function safeExecuteTool')) throw new Error('legacy safe executor still present');
if (!src.includes("from './ai/tools/executor.js'")) throw new Error('executor import missing');
if (!src.includes('dispatchTool = createToolExecutor')) throw new Error('executor registry missing');

fs.writeFileSync(path, src);
console.log('Migrated chat tool dispatch/error isolation to ai/tools/executor.js');
