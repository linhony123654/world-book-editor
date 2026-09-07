import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

const block = `const MUTATING_TOOL_NAMES = new Set([\n  'edit_entry', 'add_entry', 'add_entries', 'create_smart_entry',\n  'delete_entry', 'delete_entries', 'batch_edit', 'replace_text',\n  'manage_keys', 'move_entry', 'toggle_entry', 'reorder_entry',\n  'duplicate_entry', 'merge_entries', 'split_entry'\n]);`;

const occurrences = src.split(block).length - 1;
if (occurrences < 2) {
  throw new Error('Expected duplicate MUTATING_TOOL_NAMES declarations, found ' + occurrences);
}

src = src.replace(new RegExp(block.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\n\\n' + block.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')+'), block);

const remaining = src.split(block).length - 1;
if (remaining !== 1) {
  throw new Error('Repair failed; remaining declarations: ' + remaining);
}

fs.writeFileSync(path, src);
console.log('Removed duplicate MUTATING_TOOL_NAMES declarations:', occurrences, '->', remaining);
