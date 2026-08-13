// ===== 工具名单单一来源 =====
// 所有 AI 工具调用解析/清洗用的名单与正则都从这里派生，
// 避免工具名在 chat.js / memory-summary.js 等多处重复出现导致漂移。

export const TOOL_NAMES = [
  'search_entries', 'get_entry', 'edit_entry', 'add_entry', 'add_entries',
  'get_writing_template', 'update_writing_template',
  'plan_smart_entry', 'create_smart_entry',
  'delete_entry', 'delete_entries', 'batch_edit', 'replace_text', 'manage_keys', 'move_entry',
  'list_entries', 'toggle_entry', 'reorder_entry', 'duplicate_entry',
  'merge_entries', 'split_entry', 'check_entries', 'test_triggers', 'export_book',
  'undo_last', 'get_book_info', 'list_books', 'switch_book', 'create_book', 'rename_book', 'delete_book'
];

// 供各模块拼正则用的联合模式（工具名都是 \w+，无需转义）
export const TOOL_NAME_PATTERN = TOOL_NAMES.join('|');
