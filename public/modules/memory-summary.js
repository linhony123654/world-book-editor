const TOOL_NAME_RE = /\b(search_entries|get_entry|edit_entry|add_entry|add_entries|get_writing_template|update_writing_template|plan_smart_entry|create_smart_entry|delete_entry|delete_entries|batch_edit|replace_text|manage_keys|move_entry|list_entries|toggle_entry|reorder_entry|duplicate_entry|merge_entries|split_entry|check_entries|test_triggers|export_book|undo_last|get_book_info|list_books|switch_book|create_book|rename_book|delete_book)\b/g;

export function containsToolCallSyntax(text) {
  if (!text) return false;
  return /<tool_call>|<tool_use>|<function=/.test(text) ||
    /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/.test(text) ||
    /\b\w+\s*\([^)]*\)/.test(text);
}

function cleanTraceLine(line) {
  let text = String(line || '').trim();
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  text = text.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '');
  text = text.replace(/<function=\w+>[\s\S]*?<\/function>/g, '');
  text = text.replace(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, '');
  text = text.replace(TOOL_NAME_RE, '');
  text = text.replace(/^\s*[:：-]+\s*/, '');
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}

export function summarizeToolTraceForMemory(trace) {
  const details = (trace || []).map(cleanTraceLine).filter(Boolean).slice(-6);
  if (!details.length) return '';
  return '完成了 ' + (trace || []).length + ' 项操作：' + details.join('；') + '。';
}
