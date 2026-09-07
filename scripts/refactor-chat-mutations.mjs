import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

function replaceBetween(startMarker, endMarker, replacement) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('start marker not found: ' + startMarker.slice(0, 80));
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error('end marker not found: ' + endMarker.slice(0, 80));
  src = src.slice(0, start) + replacement.trimEnd() + '\n\n' + src.slice(end);
}

const oldStateImport = "import { worldBook, entries, currentUid, currentBookId, nextUid, createEntry, uidKey, setEntries, snapshotForUndo, restoreUndo, undoStackLength, restoreUndoTo } from './state.js';";
const newStateImport = "import { worldBook, entries, currentUid, currentBookId, nextUid, createEntry, setEntries, snapshotForUndo, restoreUndo, undoStackLength, restoreUndoTo } from './state.js';";
if (src.includes(oldStateImport)) src = src.replace(oldStateImport, newStateImport);

const commandImports = "import { runWorldBookCommand } from './domain/command-runtime.js';\nimport { CommandType } from './domain/worldbook-commands.js';\n";
if (!src.includes("./domain/command-runtime.js")) {
  const anchor = "import { streamFetch, streamSSE } from './ai/transport.js';\n";
  if (!src.includes(anchor)) throw new Error('transport import anchor missing');
  src = src.replace(anchor, anchor + commandImports);
}

replaceBetween(
  'async function safeExecuteTool(name, args) {',
  'async function sendChat(prevText) {',
  `const MUTATING_TOOL_NAMES = new Set([
  'edit_entry', 'add_entry', 'add_entries', 'create_smart_entry',
  'delete_entry', 'delete_entries', 'batch_edit', 'replace_text',
  'manage_keys', 'move_entry', 'toggle_entry', 'reorder_entry',
  'duplicate_entry', 'merge_entries', 'split_entry'
]);

async function safeExecuteTool(name, args) {
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
}`
);

replaceBetween(
  'function toolEdit({ uid, fields }) {',
  'function applyEntryMeta(entry, semanticType, functionType, extra) {',
  `function toolEdit({ uid, fields }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const patch = {};
  const accepted = [];
  const ignored = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === 'uid') continue;
    const nv = normalizeEntryFieldValue(k, v);
    if (nv === undefined) { ignored.push(k); continue; }
    patch[k] = nv;
    accepted.push(k);
  }
  if (!accepted.length) return { summary: '没有可修改的合法字段', detail: '传入字段均不在白名单内或为空：' + ignored.join(', ') };
  const result = runWorldBookCommand({ type: CommandType.PATCH_ENTRY, uid, patch }, { label: '编辑 #' + uid });
  if (!result.changed) return { summary: '#' + uid + ' 没有实际变化', detail: '字段值与当前条目一致' };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  const ignoreNote = ignored.length ? '；忽略非法/未知字段: ' + ignored.join(', ') : '';
  return { summary: '已修改 #' + uid + ' 的 ' + accepted.join(','), detail: '修改字段: ' + accepted.join(', ') + ignoreNote, changes: [{ type: 'edit', uid, comment: e.comment || '', detail: accepted.join(',') }] };
}`
);

replaceBetween(
  'function toolAdd({ comment, content, key, constant, semanticType, functionType }) {',
  'function toolAddMany({ entries: items }) {',
  `function toolAdd({ comment, content, key, constant, semanticType, functionType }) {
  const uid = nextUid();
  const entry = createEntry(uid);
  if (comment) entry.comment = comment;
  if (content) entry.content = content;
  if (Array.isArray(key)) entry.key = key.map(String);
  if (typeof constant === 'boolean') entry.constant = constant;
  applyEntryMeta(entry, semanticType, functionType);
  const result = runWorldBookCommand({ type: CommandType.CREATE_ENTRY, entry }, { label: '新增条目' });
  if (!result.changed) return { summary: '新增失败', detail: '条目未发生写入' };
  renderSidebar();
  scheduleSave();
  return { summary: '已创建 #' + uid, detail: '新条目 UID: ' + uid, changes: [{ type: 'add', uid, comment: comment || '', detail: (content || '').length + ' 字' }] };
}`
);

replaceBetween(
  'function toolAddMany({ entries: items }) {',
  'async function toolCreateSmartEntry(args) {',
  `function toolAddMany({ entries: items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { summary: '未提供条目', detail: 'entries 需为非空数组' };
  }
  const prepared = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const entry = createEntry(prepared.length);
    if (it.comment) entry.comment = it.comment;
    if (it.content) entry.content = it.content;
    if (Array.isArray(it.key)) entry.key = it.key.map(String);
    if (typeof it.constant === 'boolean') entry.constant = it.constant;
    applyEntryMeta(entry, it.semanticType, it.functionType);
    prepared.push(entry);
  }
  if (!prepared.length) return { summary: '未提供有效条目', detail: 'entries 中没有可创建的对象' };
  const result = runWorldBookCommand({ type: CommandType.MERGE_ENTRIES, entries: prepared, skipDuplicates: false }, { label: '批量新增 ' + prepared.length + ' 条' });
  const created = result.createdUids;
  renderSidebar();
  scheduleSave();
  const uidStr = created.length > 8 ? created.slice(0, 8).join(',') + '…' : created.join(',');
  return {
    summary: '已新增 ' + created.length + ' 条 (UID ' + uidStr + ')',
    detail: '新条目 UID: ' + created.join(', '),
    changes: created.slice(0, 12).map(uid => {
      const e = entries.find(x => x.uid === uid);
      return { type: 'add', uid, comment: (e && e.comment) || '' };
    })
  };
}`
);

replaceBetween(
  'function commitSmartDraft(draft) {',
  '// 创建后体检联动：新条目自身风险 + 与全书的冲突/共享提示',
  `function commitSmartDraft(draft) {
  const uid = nextUid();
  const entry = createEntry(uid);
  applyDraftToEntry(entry, draft);
  const result = runWorldBookCommand({ type: CommandType.CREATE_ENTRY, entry }, { label: '智能新增条目' });
  if (!result.changed) return { summary: '智能创建失败', detail: '条目未发生写入', changes: [], uid: null };
  renderSidebar();
  scheduleSave();
  return { summary: '已智能创建 #' + uid + '「' + draft.title + '」', detail: smartDraftDetail(draft, uid), changes: [{ type: 'add', uid, comment: draft.title || '', detail: '智能创建' }], uid };
}`
);

replaceBetween(
  'function toolDelete({ uid }) {',
  '// 共用条目筛选：constant / disable / uid_range / query',
  `function toolDelete({ uid }) {
  const target = getAllEntries().find(e => e.uid === uid);
  if (!target) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const title = target.comment || '';
  const result = runWorldBookCommand({ type: CommandType.DELETE_ENTRIES, uids: [uid] }, { label: '删除 #' + uid });
  if (!result.changed) return { summary: '未删除 #' + uid, detail: '条目未发生变化' };
  if (currentUid === uid) {
    import('./state.js').then(m => m.setCurrentUid(null));
    renderEditorEmpty();
  }
  renderSidebar();
  scheduleSave();
  return { summary: '已删除 #' + uid, detail: '已删除 UID ' + uid, changes: [{ type: 'delete', uid, comment: title }] };
}`
);

replaceBetween(
  'function toolDeleteMany({ uids, filter }) {',
  'function toolBatchEdit({ filter, fields }) {',
  `function toolDeleteMany({ uids, filter }) {
  let targets;
  if (Array.isArray(uids) && uids.length > 0) {
    const set = new Set(uids);
    targets = getAllEntries().filter(e => set.has(e.uid));
  } else if (filter) {
    targets = applyEntryFilter(getAllEntries(), filter);
  } else {
    return { summary: '未提供条件', detail: '需提供 uids 数组或 filter 条件' };
  }
  if (targets.length === 0) return { summary: '无匹配条目', detail: '没有匹配的条目，未删除' };
  const delUids = targets.map(e => e.uid);
  const result = runWorldBookCommand({ type: CommandType.DELETE_ENTRIES, uids: delUids }, { label: '批量删除 ' + targets.length + ' 条' });
  if (!result.changed) return { summary: '无条目被删除', detail: '目标条目已不存在' };
  if (currentUid !== null && result.deletedUids.includes(currentUid)) {
    import('./state.js').then(m => m.setCurrentUid(null));
    renderEditorEmpty();
  }
  renderSidebar();
  scheduleSave();
  const dStr = result.deletedUids.length > 8 ? result.deletedUids.slice(0, 8).join(',') + '…' : result.deletedUids.join(',');
  return {
    summary: '已删除 ' + result.deletedUids.length + ' 条 (UID ' + dStr + ')',
    detail: '已删除 UID: ' + result.deletedUids.join(', '),
    changes: targets.filter(e => result.deletedUids.includes(e.uid)).slice(0, 12).map(e => ({ type: 'delete', uid: e.uid, comment: e.comment || '' }))
  };
}`
);

replaceBetween(
  'function toolBatchEdit({ filter, fields }) {',
  'function escapeRegExp(s) {',
  `function toolBatchEdit({ filter, fields }) {
  const list = applyEntryFilter(getAllEntries(), filter);
  if (list.length === 0) return { summary: '无匹配条目', detail: '筛选条件未匹配到任何条目，未做修改' };
  const patch = {};
  const changed = [];
  const ignored = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === 'uid') continue;
    const nv = normalizeEntryFieldValue(k, v);
    if (nv === undefined) { ignored.push(k); continue; }
    patch[k] = nv;
    changed.push(k);
  }
  if (!changed.length) return { summary: '没有可修改的合法字段', detail: '传入字段均不在白名单内或为空：' + ignored.join(', ') };
  const result = runWorldBookCommand({
    type: CommandType.PATCH_ENTRIES,
    patches: list.map(e => ({ uid: e.uid, patch }))
  }, { label: '批量修改 ' + list.length + ' 条' });
  if (!result.changed) return { summary: '匹配条目无需修改', detail: '目标字段已经是请求值' };
  renderSidebar();
  if (currentUid != null) {
    const current = entries.find(e => e.uid === currentUid);
    if (current && result.affectedUids.includes(current.uid)) renderEditor(current);
  }
  scheduleSave();
  const ignoreNote = ignored.length ? '；忽略非法/未知字段: ' + ignored.join(', ') : '';
  return {
    summary: '已批量修改 ' + result.affectedUids.length + ' 条',
    detail: '修改字段: ' + changed.join(', ') + '，影响 ' + result.affectedUids.length + ' 条' + ignoreNote,
    changes: list.filter(e => result.affectedUids.includes(e.uid)).slice(0, 12).map(e => ({ type: 'edit', uid: e.uid, comment: e.comment || '', detail: changed.join(',') }))
  };
}`
);

replaceBetween(
  'function toolReplaceText({ find, replace, fields, uid, filter, regex, ignore_case }) {',
  '// 增删某条目的关键词（主 key 或次 keysecondary）',
  `function toolReplaceText({ find, replace, fields, uid, filter, regex, ignore_case }) {
  if (find == null || find === '') return { summary: 'find 不能为空', detail: '需要提供要查找的文本' };
  if (replace == null) replace = '';
  const allow = ['content', 'comment', 'key'];
  let cols = Array.isArray(fields) && fields.length ? fields.filter(f => allow.includes(f)) : ['content'];
  if (!cols.length) cols = ['content'];

  let re;
  try {
    const flags = 'g' + (ignore_case ? 'i' : '');
    re = new RegExp(regex ? find : escapeRegExp(find), flags);
  } catch (e) { return { summary: '正则无效', detail: e.message }; }

  let targets;
  if (uid != null) {
    const e = getAllEntries().find(x => x.uid === uid);
    if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    targets = [e];
  } else {
    targets = applyEntryFilter(getAllEntries(), filter);
  }
  if (!targets.length) return { summary: '无匹配条目', detail: '筛选条件未匹配到任何条目' };

  const countIn = (str) => {
    re.lastIndex = 0;
    const m = String(str).match(re);
    re.lastIndex = 0;
    return m ? m.length : 0;
  };
  const doRepl = (str) => {
    re.lastIndex = 0;
    const out = regex ? String(str).replace(re, replace) : String(str).replace(re, () => replace);
    re.lastIndex = 0;
    return out;
  };

  let total = 0;
  const pending = [];
  for (const e of targets) {
    let hit = 0;
    const patch = {};
    for (const col of cols) {
      if (col === 'key') {
        const arr = Array.isArray(e.key) ? e.key : [];
        const colHits = arr.reduce((sum, k) => sum + countIn(k), 0);
        if (colHits > 0) patch.key = arr.map(k => doRepl(k)).filter(k => k !== '');
        hit += colHits;
      } else if (typeof e[col] === 'string') {
        const colHits = countIn(e[col]);
        if (colHits > 0) patch[col] = doRepl(e[col]);
        hit += colHits;
      }
    }
    if (hit > 0) { pending.push({ entry: e, patch }); total += hit; }
  }
  if (total === 0) return { summary: '未找到「' + find + '」', detail: '在 ' + targets.length + ' 条目的 ' + cols.join('/') + ' 中没有匹配' };

  const result = runWorldBookCommand({
    type: CommandType.PATCH_ENTRIES,
    patches: pending.map(item => ({ uid: item.entry.uid, patch: item.patch }))
  }, { label: '替换「' + find + '」→「' + replace + '」(' + pending.length + ' 条)' });
  if (!result.changed) return { summary: '替换后没有实际变化', detail: '匹配结果与原值一致' };
  if (currentUid != null && result.affectedUids.includes(currentUid)) {
    const cur = entries.find(e => e.uid === currentUid);
    if (cur) renderEditor(cur);
  }
  renderSidebar();
  scheduleSave();
  return {
    summary: '已替换 ' + total + ' 处，影响 ' + result.affectedUids.length + ' 条',
    detail: '在 ' + cols.join('/') + ' 把「' + find + '」替换为「' + replace + '」' + (regex ? '（正则）' : '') + '，共 ' + total + ' 处 / ' + result.affectedUids.length + ' 个条目',
    changes: pending.filter(item => result.affectedUids.includes(item.entry.uid)).slice(0, 12).map(item => ({ type: 'edit', uid: item.entry.uid, comment: item.entry.comment || '', detail: '替换「' + find + '」' }))
  };
}`
);

replaceBetween(
  'function toolManageKeys({ uid, add, remove, secondary }) {',
  '// 设置条目插入位置 position（与 reorder 的 order 数值互补）',
  `function toolManageKeys({ uid, add, remove, secondary }) {
  const e = getAllEntries().find(x => x.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const addArr = Array.isArray(add) ? add.map(s => String(s).trim()).filter(Boolean) : [];
  const rmArr = Array.isArray(remove) ? remove.map(s => String(s).trim()).filter(Boolean) : [];
  if (!addArr.length && !rmArr.length) return { summary: '无操作', detail: '需提供 add 或 remove 数组' };
  const field = secondary ? 'keysecondary' : 'key';
  const label = secondary ? '次要关键词' : '关键词';
  let arr = Array.isArray(e[field]) ? e[field].slice() : [];
  let added = 0, removed = 0;
  if (rmArr.length) {
    const rmSet = new Set(rmArr);
    const before = arr.length;
    arr = arr.filter(k => !rmSet.has(k));
    removed = before - arr.length;
  }
  for (const k of addArr) { if (!arr.includes(k)) { arr.push(k); added++; } }
  const result = runWorldBookCommand({ type: CommandType.PATCH_ENTRY, uid, patch: { [field]: arr } }, { label: '调整 #' + uid + ' 的' + label });
  if (!result.changed) return { summary: '无实际变化', detail: '#' + uid + ' 的' + label + '无需修改' };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  return {
    summary: '#' + uid + ' ' + label + ' +' + added + ' / -' + removed,
    detail: '#' + uid + ' 当前' + label + '：' + (arr.length ? arr.join('、') : '(空)'),
    changes: [{ type: 'edit', uid, comment: e.comment || '', detail: label + (added ? ' +' + added : '') + (removed ? ' -' + removed : '') }]
  };
}`
);

replaceBetween(
  'function toolMoveEntry({ uid, position, depth }) {',
  'function toolList({ filter, limit } = {}) {',
  `function toolMoveEntry({ uid, position, depth }) {
  const e = getAllEntries().find(x => x.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  if (typeof position !== 'number') return { summary: 'position 须为数字', detail: '收到的 position: ' + position };
  const names = { 0: '角色定义前', 1: '角色定义后', 2: '作者注释前', 3: '作者注释后', 4: '@深度' };
  const patch = { position };
  let extra = '';
  if (position === 4 && typeof depth === 'number') { patch.depth = depth; extra = '，深度 ' + depth; }
  const result = runWorldBookCommand({ type: CommandType.PATCH_ENTRY, uid, patch }, { label: '移动位置 #' + uid });
  if (!result.changed) return { summary: '#' + uid + ' 位置无需修改', detail: 'position/depth 已是目标值' };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  const posName = names[position] || ('position=' + position);
  return { summary: '#' + uid + ' 移到「' + posName + '」' + extra, detail: '#' + uid + ' position=' + position + '（' + posName + '）' + extra, changes: [{ type: 'edit', uid, comment: e.comment || '', detail: 'position=' + position }] };
}`
);

replaceBetween(
  'function toolToggle({ uid, disable }) {',
  'function toolReorder({ uid, order }) {',
  `function toolToggle({ uid, disable }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const next = (disable === undefined || disable === null) ? !e.disable : !!disable;
  const result = runWorldBookCommand({ type: CommandType.SET_ENTRY_FIELD, uids: [uid], field: 'disable', value: next }, { label: (next ? '禁用' : '启用') + ' #' + uid });
  if (!result.changed) return { summary: '#' + uid + ' 状态无需修改', detail: '当前已是目标状态' };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  const state = e.disable ? '已禁用' : '已启用';
  return { summary: '#' + uid + ' ' + state, detail: '#' + uid + ' (' + (e.comment||'') + ') ' + state, changes: [{ type: 'edit', uid, comment: e.comment || '', detail: state }] };
}`
);

replaceBetween(
  'function toolReorder({ uid, order }) {',
  'function toolDuplicate({ uid }) {',
  `function toolReorder({ uid, order }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  if (typeof order !== 'number') return { summary: 'order 须为数字', detail: '收到的 order: ' + order };
  const result = runWorldBookCommand({ type: CommandType.SET_ENTRY_FIELD, uids: [uid], field: 'order', value: order }, { label: '调整顺序 #' + uid });
  if (!result.changed) return { summary: '#' + uid + ' order 无需修改', detail: 'order 已是 ' + order };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  return { summary: '#' + uid + ' order=' + order, detail: '#' + uid + ' (' + (e.comment||'') + ') order 已设为 ' + order, changes: [{ type: 'edit', uid, comment: e.comment || '', detail: 'order=' + order }] };
}`
);

replaceBetween(
  'function toolDuplicate({ uid }) {',
  '// ===== 合并条目 =====',
  `function toolDuplicate({ uid }) {
  const srcEntry = getAllEntries().find(e => e.uid === uid);
  if (!srcEntry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const result = runWorldBookCommand({ type: CommandType.DUPLICATE_ENTRY, sourceUid: uid }, { label: '复制 #' + uid });
  if (!result.changed) return { summary: '复制失败', detail: '没有创建副本' };
  const newUid = result.createdUids[0];
  const copy = entries.find(e => e.uid === newUid);
  renderSidebar();
  scheduleSave();
  return { summary: '已复制 #' + uid + ' → #' + newUid, detail: '新副本 UID: ' + newUid + '（标题: ' + ((copy && copy.comment) || '') + '）', changes: [{ type: 'add', uid: newUid, comment: (copy && copy.comment) || '', detail: '复制自 #' + uid }] };
}`
);

replaceBetween(
  'function toolMergeEntries({ uids, keep }) {',
  '// ===== 拆分条目 =====',
  `function toolMergeEntries({ uids, keep }) {
  const list = getAllEntries();
  const targets = (Array.isArray(uids) ? uids : []).map(u => list.find(e => e.uid === u)).filter(Boolean);
  if (targets.length < 2) return { summary: '合并失败', detail: '需要至少 2 个存在的 UID，传入: ' + JSON.stringify(uids) };
  const keepUid = (keep != null && targets.some(t => t.uid === keep)) ? keep : targets[0].uid;
  const result = runWorldBookCommand({ type: CommandType.MERGE_EXISTING_ENTRIES, uids: targets.map(t => t.uid), keep: keepUid }, { label: '合并条目 ' + targets.map(t => '#' + t.uid).join('+') });
  if (!result.changed) return { summary: '合并失败', detail: '目标条目不足或没有变化' };
  const kept = entries.find(e => e.uid === result.keptUid);
  renderSidebar();
  if (currentUid != null && result.deletedUids.includes(currentUid)) selectEntry(result.keptUid);
  scheduleSave();
  return {
    summary: '已合并 ' + targets.length + ' 条 → #' + result.keptUid + '「' + ((kept && kept.comment) || '') + '」',
    detail: '保留 #' + result.keptUid + '，删除 ' + result.deletedUids.map(uid => '#' + uid).join('、') + '；关键词合并为: ' + ((kept && kept.key && kept.key.length) ? kept.key.join('、') : '(无)') + '。可 undo_last 回退。',
    changes: [
      { type: 'merge', uid: result.keptUid, comment: (kept && kept.comment) || '', detail: '合并 ' + targets.length + ' 条' },
      ...targets.filter(t => result.deletedUids.includes(t.uid)).slice(0, 11).map(t => ({ type: 'delete', uid: t.uid, comment: t.comment || '' }))
    ]
  };
}`
);

replaceBetween(
  'function toolSplitEntry({ uid, parts }) {',
  '// ===== 查重：按标题相同/子串、关键词重叠、正文开头相同找疑似重复条目 =====',
  `function toolSplitEntry({ uid, parts }) {
  const srcEntry = getAllEntries().find(e => e.uid === uid);
  if (!srcEntry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const list = Array.isArray(parts) ? parts.filter(p => p && String(p.comment || '').trim() && String(p.content || '').trim()) : [];
  if (list.length < 2) return { summary: '拆分失败', detail: 'parts 至少需要 2 个含标题和正文的条目' };
  const result = runWorldBookCommand({ type: CommandType.SPLIT_ENTRY, sourceUid: uid, parts: list }, { label: '拆分 #' + uid });
  if (!result.changed) return { summary: '拆分失败', detail: '条目未发生变化' };
  renderSidebar();
  if (currentUid === uid) {
    if (result.createdUids.length) selectEntry(result.createdUids[0]);
    else renderEditorEmpty();
  }
  scheduleSave();
  return {
    summary: '已拆分 #' + uid + ' → ' + result.createdUids.length + ' 条',
    detail: '新条目 UID: ' + result.createdUids.join('、') + '（可 undo_last 回退）',
    changes: [
      { type: 'split', uid, comment: srcEntry.comment || '', detail: '拆为 ' + result.createdUids.length + ' 条' },
      ...result.createdUids.slice(0, 12).map(newUid => ({ type: 'add', uid: newUid, comment: (entries.find(x => x.uid === newUid) || {}).comment || '' }))
    ]
  };
}`
);

if (src.includes('worldBook.entries[')) throw new Error('direct worldBook.entries mutation/read remains in chat.js');
if (src.includes('uidKey(')) throw new Error('uidKey dependency remains in chat.js');
if (!src.includes('CommandType.MERGE_EXISTING_ENTRIES')) throw new Error('merge tool was not migrated');
if (!src.includes('CommandType.SPLIT_ENTRY')) throw new Error('split tool was not migrated');
if (!src.includes('CommandType.PATCH_ENTRIES')) throw new Error('batch patch tools were not migrated');
const snapshots = (src.match(/snapshotForUndo\(/g) || []).length;
if (snapshots !== 1) throw new Error('chat.js should keep exactly one turn-boundary snapshot, found ' + snapshots);

fs.writeFileSync(path, src);
console.log('chat mutation migration applied');
