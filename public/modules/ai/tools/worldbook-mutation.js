import { CommandType } from '../../domain/worldbook-commands.js';
import { applyEntryFilter } from './worldbook-read.js';

export const WORLD_BOOK_MUTATION_TOOL_NAMES = Object.freeze([
  'edit_entry', 'add_entry', 'add_entries', 'delete_entry', 'delete_entries',
  'batch_edit', 'replace_text', 'manage_keys', 'move_entry', 'toggle_entry',
  'reorder_entry', 'duplicate_entry', 'merge_entries', 'split_entry'
]);

// Mirrors state.js createEntry fields. AI writes outside this list are discarded.
export const ENTRY_FIELD_TYPES = Object.freeze({
  key: 'array', keysecondary: 'array', triggers: 'array',
  comment: 'string', content: 'string', group: 'string', role: 'string',
  automationId: 'string', outletName: 'string',
  constant: 'boolean', selective: 'boolean', addMemo: 'boolean', groupOverride: 'boolean',
  useProbability: 'boolean', vectorized: 'boolean', excludeRecursion: 'boolean',
  preventRecursion: 'boolean', delayUntilRecursion: 'boolean', ignoreBudget: 'boolean',
  matchPersonaDescription: 'boolean', matchCharacterDescription: 'boolean',
  matchCharacterPersonality: 'boolean', matchCharacterDepthPrompt: 'boolean',
  matchScenario: 'boolean', matchCreatorNotes: 'boolean', disable: 'boolean',
  selectiveLogic: 'number', order: 'number', position: 'number', groupWeight: 'number',
  sticky: 'number', cooldown: 'number', delay: 'number', probability: 'number',
  depth: 'number', displayIndex: 'number', scanDepth: 'number', caseSensitive: 'number',
  matchWholeWords: 'number', useGroupScoring: 'number',
  characterFilter: 'object'
});

export function normalizeEntryFieldValue(key, value) {
  const type = ENTRY_FIELD_TYPES[key];
  if (!type || value === undefined) return undefined;
  if (value === null) {
    return (key === 'role' || key === 'scanDepth' || key === 'caseSensitive' || key === 'matchWholeWords' || key === 'useGroupScoring')
      ? null
      : undefined;
  }
  switch (type) {
    case 'boolean': return Boolean(value);
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'string': return String(value);
    case 'array':
      return Array.isArray(value)
        ? value.map(String)
        : (typeof value === 'string' ? value.split(/[,，]/).map(s => s.trim()).filter(Boolean) : []);
    case 'object': return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    default: return undefined;
  }
}

function applyEntryMeta(entry, semanticType, functionType, extra) {
  if (!semanticType && !functionType && !extra) return;
  entry.extensions = entry.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
  entry.extensions.wbe = entry.extensions.wbe && typeof entry.extensions.wbe === 'object' ? entry.extensions.wbe : {};
  if (semanticType) entry.extensions.wbe.semanticType = semanticType;
  if (functionType) entry.extensions.wbe.functionType = functionType;
  if (extra && typeof extra === 'object') Object.assign(entry.extensions.wbe, extra);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createWorldBookMutationHandlers({
  getEntries,
  getCurrentUid,
  nextUid,
  createEntry,
  runCommand,
  renderSidebar,
  renderEditor,
  renderEditorEmpty,
  selectEntry,
  clearCurrentUid,
  scheduleSave
} = {}) {
  const allEntries = () => getEntries();
  const currentUid = () => getCurrentUid();

  function toolEdit({ uid, fields } = {}) {
    const entry = allEntries().find(item => item.uid === uid);
    if (!entry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    const patch = {};
    const accepted = [];
    const ignored = [];
    for (const [key, value] of Object.entries(fields || {})) {
      if (key === 'uid') continue;
      const normalized = normalizeEntryFieldValue(key, value);
      if (normalized === undefined) { ignored.push(key); continue; }
      patch[key] = normalized;
      accepted.push(key);
    }
    if (!accepted.length) return { summary: '没有可修改的合法字段', detail: '传入字段均不在白名单内或为空：' + ignored.join(', ') };
    const result = runCommand({ type: CommandType.PATCH_ENTRY, uid, patch }, { label: '编辑 #' + uid });
    if (!result.changed) return { summary: '#' + uid + ' 没有实际变化', detail: '字段值与当前条目一致' };
    if (currentUid() === uid) renderEditor(entry);
    renderSidebar();
    scheduleSave();
    const ignoreNote = ignored.length ? '；忽略非法/未知字段: ' + ignored.join(', ') : '';
    return {
      summary: '已修改 #' + uid + ' 的 ' + accepted.join(','),
      detail: '修改字段: ' + accepted.join(', ') + ignoreNote,
      changes: [{ type: 'edit', uid, comment: entry.comment || '', detail: accepted.join(',') }]
    };
  }

  function toolAdd({ comment, content, key, constant, semanticType, functionType } = {}) {
    const uid = nextUid();
    const entry = createEntry(uid);
    if (comment) entry.comment = comment;
    if (content) entry.content = content;
    if (Array.isArray(key)) entry.key = key.map(String);
    if (typeof constant === 'boolean') entry.constant = constant;
    applyEntryMeta(entry, semanticType, functionType);
    const result = runCommand({ type: CommandType.CREATE_ENTRY, entry }, { label: '新增条目' });
    if (!result.changed) return { summary: '新增失败', detail: '条目未发生写入' };
    renderSidebar();
    scheduleSave();
    return {
      summary: '已创建 #' + uid,
      detail: '新条目 UID: ' + uid,
      changes: [{ type: 'add', uid, comment: comment || '', detail: (content || '').length + ' 字' }]
    };
  }

  function toolAddMany({ entries: items } = {}) {
    if (!Array.isArray(items) || items.length === 0) return { summary: '未提供条目', detail: 'entries 需为非空数组' };
    const prepared = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const entry = createEntry(prepared.length);
      if (item.comment) entry.comment = item.comment;
      if (item.content) entry.content = item.content;
      if (Array.isArray(item.key)) entry.key = item.key.map(String);
      if (typeof item.constant === 'boolean') entry.constant = item.constant;
      applyEntryMeta(entry, item.semanticType, item.functionType);
      prepared.push(entry);
    }
    if (!prepared.length) return { summary: '未提供有效条目', detail: 'entries 中没有可创建的对象' };
    const result = runCommand({ type: CommandType.MERGE_ENTRIES, entries: prepared, skipDuplicates: false }, { label: '批量新增 ' + prepared.length + ' 条' });
    const created = result.createdUids;
    renderSidebar();
    scheduleSave();
    const uidStr = created.length > 8 ? created.slice(0, 8).join(',') + '…' : created.join(',');
    return {
      summary: '已新增 ' + created.length + ' 条 (UID ' + uidStr + ')',
      detail: '新条目 UID: ' + created.join(', '),
      changes: created.slice(0, 12).map(uid => {
        const entry = allEntries().find(item => item.uid === uid);
        return { type: 'add', uid, comment: (entry && entry.comment) || '' };
      })
    };
  }

  function toolDelete({ uid } = {}) {
    const target = allEntries().find(entry => entry.uid === uid);
    if (!target) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    const title = target.comment || '';
    const result = runCommand({ type: CommandType.DELETE_ENTRIES, uids: [uid] }, { label: '删除 #' + uid });
    if (!result.changed) return { summary: '未删除 #' + uid, detail: '条目未发生变化' };
    if (currentUid() === uid) {
      clearCurrentUid();
      renderEditorEmpty();
    }
    renderSidebar();
    scheduleSave();
    return { summary: '已删除 #' + uid, detail: '已删除 UID ' + uid, changes: [{ type: 'delete', uid, comment: title }] };
  }

  function toolDeleteMany({ uids, filter } = {}) {
    let targets;
    if (Array.isArray(uids) && uids.length > 0) {
      const set = new Set(uids);
      targets = allEntries().filter(entry => set.has(entry.uid));
    } else if (filter) {
      targets = applyEntryFilter(allEntries(), filter);
    } else {
      return { summary: '未提供条件', detail: '需提供 uids 数组或 filter 条件' };
    }
    if (targets.length === 0) return { summary: '无匹配条目', detail: '没有匹配的条目，未删除' };
    const result = runCommand({ type: CommandType.DELETE_ENTRIES, uids: targets.map(entry => entry.uid) }, { label: '批量删除 ' + targets.length + ' 条' });
    if (!result.changed) return { summary: '无条目被删除', detail: '目标条目已不存在' };
    if (currentUid() !== null && result.deletedUids.includes(currentUid())) {
      clearCurrentUid();
      renderEditorEmpty();
    }
    renderSidebar();
    scheduleSave();
    const dStr = result.deletedUids.length > 8 ? result.deletedUids.slice(0, 8).join(',') + '…' : result.deletedUids.join(',');
    return {
      summary: '已删除 ' + result.deletedUids.length + ' 条 (UID ' + dStr + ')',
      detail: '已删除 UID: ' + result.deletedUids.join(', '),
      changes: targets.filter(entry => result.deletedUids.includes(entry.uid)).slice(0, 12).map(entry => ({ type: 'delete', uid: entry.uid, comment: entry.comment || '' }))
    };
  }

  function toolBatchEdit({ filter, fields } = {}) {
    const list = applyEntryFilter(allEntries(), filter);
    if (list.length === 0) return { summary: '无匹配条目', detail: '筛选条件未匹配到任何条目，未做修改' };
    const patch = {};
    const changed = [];
    const ignored = [];
    for (const [key, value] of Object.entries(fields || {})) {
      if (key === 'uid') continue;
      const normalized = normalizeEntryFieldValue(key, value);
      if (normalized === undefined) { ignored.push(key); continue; }
      patch[key] = normalized;
      changed.push(key);
    }
    if (!changed.length) return { summary: '没有可修改的合法字段', detail: '传入字段均不在白名单内或为空：' + ignored.join(', ') };
    const result = runCommand({
      type: CommandType.PATCH_ENTRIES,
      patches: list.map(entry => ({ uid: entry.uid, patch }))
    }, { label: '批量修改 ' + list.length + ' 条' });
    if (!result.changed) return { summary: '匹配条目无需修改', detail: '目标字段已经是请求值' };
    renderSidebar();
    const selectedUid = currentUid();
    if (selectedUid != null) {
      const selected = allEntries().find(entry => entry.uid === selectedUid);
      if (selected && result.affectedUids.includes(selected.uid)) renderEditor(selected);
    }
    scheduleSave();
    const ignoreNote = ignored.length ? '；忽略非法/未知字段: ' + ignored.join(', ') : '';
    return {
      summary: '已批量修改 ' + result.affectedUids.length + ' 条',
      detail: '修改字段: ' + changed.join(', ') + '，影响 ' + result.affectedUids.length + ' 条' + ignoreNote,
      changes: list.filter(entry => result.affectedUids.includes(entry.uid)).slice(0, 12).map(entry => ({ type: 'edit', uid: entry.uid, comment: entry.comment || '', detail: changed.join(',') }))
    };
  }

  function toolReplaceText({ find, replace, fields, uid, filter, regex, ignore_case } = {}) {
    if (find == null || find === '') return { summary: 'find 不能为空', detail: '需要提供要查找的文本' };
    if (replace == null) replace = '';
    const allow = ['content', 'comment', 'key'];
    let columns = Array.isArray(fields) && fields.length ? fields.filter(field => allow.includes(field)) : ['content'];
    if (!columns.length) columns = ['content'];

    let re;
    try {
      re = new RegExp(regex ? find : escapeRegExp(find), 'g' + (ignore_case ? 'i' : ''));
    } catch (error) {
      return { summary: '正则无效', detail: error.message };
    }

    let targets;
    if (uid != null) {
      const entry = allEntries().find(item => item.uid === uid);
      if (!entry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
      targets = [entry];
    } else {
      targets = applyEntryFilter(allEntries(), filter);
    }
    if (!targets.length) return { summary: '无匹配条目', detail: '筛选条件未匹配到任何条目' };

    const countIn = value => {
      re.lastIndex = 0;
      const matches = String(value).match(re);
      re.lastIndex = 0;
      return matches ? matches.length : 0;
    };
    const replaceIn = value => {
      re.lastIndex = 0;
      const output = regex ? String(value).replace(re, replace) : String(value).replace(re, () => replace);
      re.lastIndex = 0;
      return output;
    };

    let total = 0;
    const pending = [];
    for (const entry of targets) {
      let hits = 0;
      const patch = {};
      for (const column of columns) {
        if (column === 'key') {
          const values = Array.isArray(entry.key) ? entry.key : [];
          const columnHits = values.reduce((sum, value) => sum + countIn(value), 0);
          if (columnHits > 0) patch.key = values.map(value => replaceIn(value)).filter(value => value !== '');
          hits += columnHits;
        } else if (typeof entry[column] === 'string') {
          const columnHits = countIn(entry[column]);
          if (columnHits > 0) patch[column] = replaceIn(entry[column]);
          hits += columnHits;
        }
      }
      if (hits > 0) { pending.push({ entry, patch }); total += hits; }
    }
    if (total === 0) return { summary: '未找到「' + find + '」', detail: '在 ' + targets.length + ' 条目的 ' + columns.join('/') + ' 中没有匹配' };

    const result = runCommand({
      type: CommandType.PATCH_ENTRIES,
      patches: pending.map(item => ({ uid: item.entry.uid, patch: item.patch }))
    }, { label: '替换「' + find + '」→「' + replace + '」(' + pending.length + ' 条)' });
    if (!result.changed) return { summary: '替换后没有实际变化', detail: '匹配结果与原值一致' };
    const selectedUid = currentUid();
    if (selectedUid != null && result.affectedUids.includes(selectedUid)) {
      const selected = allEntries().find(entry => entry.uid === selectedUid);
      if (selected) renderEditor(selected);
    }
    renderSidebar();
    scheduleSave();
    return {
      summary: '已替换 ' + total + ' 处，影响 ' + result.affectedUids.length + ' 条',
      detail: '在 ' + columns.join('/') + ' 把「' + find + '」替换为「' + replace + '」' + (regex ? '（正则）' : '') + '，共 ' + total + ' 处 / ' + result.affectedUids.length + ' 个条目',
      changes: pending.filter(item => result.affectedUids.includes(item.entry.uid)).slice(0, 12).map(item => ({ type: 'edit', uid: item.entry.uid, comment: item.entry.comment || '', detail: '替换「' + find + '」' }))
    };
  }

  function toolManageKeys({ uid, add, remove, secondary } = {}) {
    const entry = allEntries().find(item => item.uid === uid);
    if (!entry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    const addValues = Array.isArray(add) ? add.map(value => String(value).trim()).filter(Boolean) : [];
    const removeValues = Array.isArray(remove) ? remove.map(value => String(value).trim()).filter(Boolean) : [];
    if (!addValues.length && !removeValues.length) return { summary: '无操作', detail: '需提供 add 或 remove 数组' };
    const field = secondary ? 'keysecondary' : 'key';
    const label = secondary ? '次要关键词' : '关键词';
    let values = Array.isArray(entry[field]) ? entry[field].slice() : [];
    let added = 0;
    let removed = 0;
    if (removeValues.length) {
      const removeSet = new Set(removeValues);
      const before = values.length;
      values = values.filter(value => !removeSet.has(value));
      removed = before - values.length;
    }
    for (const value of addValues) {
      if (!values.includes(value)) { values.push(value); added++; }
    }
    const result = runCommand({ type: CommandType.PATCH_ENTRY, uid, patch: { [field]: values } }, { label: '调整 #' + uid + ' 的' + label });
    if (!result.changed) return { summary: '无实际变化', detail: '#' + uid + ' 的' + label + '无需修改' };
    if (currentUid() === uid) renderEditor(entry);
    renderSidebar();
    scheduleSave();
    return {
      summary: '#' + uid + ' ' + label + ' +' + added + ' / -' + removed,
      detail: '#' + uid + ' 当前' + label + '：' + (values.length ? values.join('、') : '(空)'),
      changes: [{ type: 'edit', uid, comment: entry.comment || '', detail: label + (added ? ' +' + added : '') + (removed ? ' -' + removed : '') }]
    };
  }

  function toolMoveEntry({ uid, position, depth } = {}) {
    const entry = allEntries().find(item => item.uid === uid);
    if (!entry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    if (typeof position !== 'number') return { summary: 'position 须为数字', detail: '收到的 position: ' + position };
    const names = { 0: '角色定义前', 1: '角色定义后', 2: '作者注释前', 3: '作者注释后', 4: '@深度' };
    const patch = { position };
    let extra = '';
    if (position === 4 && typeof depth === 'number') { patch.depth = depth; extra = '，深度 ' + depth; }
    const result = runCommand({ type: CommandType.PATCH_ENTRY, uid, patch }, { label: '移动位置 #' + uid });
    if (!result.changed) return { summary: '#' + uid + ' 位置无需修改', detail: 'position/depth 已是目标值' };
    if (currentUid() === uid) renderEditor(entry);
    renderSidebar();
    scheduleSave();
    const positionName = names[position] || ('position=' + position);
    return {
      summary: '#' + uid + ' 移到「' + positionName + '」' + extra,
      detail: '#' + uid + ' position=' + position + '（' + positionName + '）' + extra,
      changes: [{ type: 'edit', uid, comment: entry.comment || '', detail: 'position=' + position }]
    };
  }

  function toolToggle({ uid, disable } = {}) {
    const entry = allEntries().find(item => item.uid === uid);
    if (!entry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    const next = (disable === undefined || disable === null) ? !entry.disable : !!disable;
    const result = runCommand({ type: CommandType.SET_ENTRY_FIELD, uids: [uid], field: 'disable', value: next }, { label: (next ? '禁用' : '启用') + ' #' + uid });
    if (!result.changed) return { summary: '#' + uid + ' 状态无需修改', detail: '当前已是目标状态' };
    if (currentUid() === uid) renderEditor(entry);
    renderSidebar();
    scheduleSave();
    const state = entry.disable ? '已禁用' : '已启用';
    return { summary: '#' + uid + ' ' + state, detail: '#' + uid + ' (' + (entry.comment || '') + ') ' + state, changes: [{ type: 'edit', uid, comment: entry.comment || '', detail: state }] };
  }

  function toolReorder({ uid, order } = {}) {
    const entry = allEntries().find(item => item.uid === uid);
    if (!entry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    if (typeof order !== 'number') return { summary: 'order 须为数字', detail: '收到的 order: ' + order };
    const result = runCommand({ type: CommandType.SET_ENTRY_FIELD, uids: [uid], field: 'order', value: order }, { label: '调整顺序 #' + uid });
    if (!result.changed) return { summary: '#' + uid + ' order 无需修改', detail: 'order 已是 ' + order };
    if (currentUid() === uid) renderEditor(entry);
    renderSidebar();
    scheduleSave();
    return { summary: '#' + uid + ' order=' + order, detail: '#' + uid + ' (' + (entry.comment || '') + ') order 已设为 ' + order, changes: [{ type: 'edit', uid, comment: entry.comment || '', detail: 'order=' + order }] };
  }

  function toolDuplicate({ uid } = {}) {
    const source = allEntries().find(entry => entry.uid === uid);
    if (!source) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    const result = runCommand({ type: CommandType.DUPLICATE_ENTRY, sourceUid: uid }, { label: '复制 #' + uid });
    if (!result.changed) return { summary: '复制失败', detail: '没有创建副本' };
    const newUid = result.createdUids[0];
    const copy = allEntries().find(entry => entry.uid === newUid);
    renderSidebar();
    scheduleSave();
    return { summary: '已复制 #' + uid + ' → #' + newUid, detail: '新副本 UID: ' + newUid + '（标题: ' + ((copy && copy.comment) || '') + '）', changes: [{ type: 'add', uid: newUid, comment: (copy && copy.comment) || '', detail: '复制自 #' + uid }] };
  }

  function toolMergeEntries({ uids, keep } = {}) {
    const entries = allEntries();
    const targets = (Array.isArray(uids) ? uids : []).map(uid => entries.find(entry => entry.uid === uid)).filter(Boolean);
    if (targets.length < 2) return { summary: '合并失败', detail: '需要至少 2 个存在的 UID，传入: ' + JSON.stringify(uids) };
    const keepUid = (keep != null && targets.some(target => target.uid === keep)) ? keep : targets[0].uid;
    const result = runCommand({ type: CommandType.MERGE_EXISTING_ENTRIES, uids: targets.map(target => target.uid), keep: keepUid }, { label: '合并条目 ' + targets.map(target => '#' + target.uid).join('+') });
    if (!result.changed) return { summary: '合并失败', detail: '目标条目不足或没有变化' };
    const kept = allEntries().find(entry => entry.uid === result.keptUid);
    renderSidebar();
    if (currentUid() != null && result.deletedUids.includes(currentUid())) selectEntry(result.keptUid);
    scheduleSave();
    return {
      summary: '已合并 ' + targets.length + ' 条 → #' + result.keptUid + '「' + ((kept && kept.comment) || '') + '」',
      detail: '保留 #' + result.keptUid + '，删除 ' + result.deletedUids.map(uid => '#' + uid).join('、') + '；关键词合并为: ' + ((kept && kept.key && kept.key.length) ? kept.key.join('、') : '(无)') + '。可 undo_last 回退。',
      changes: [
        { type: 'merge', uid: result.keptUid, comment: (kept && kept.comment) || '', detail: '合并 ' + targets.length + ' 条' },
        ...targets.filter(target => result.deletedUids.includes(target.uid)).slice(0, 11).map(target => ({ type: 'delete', uid: target.uid, comment: target.comment || '' }))
      ]
    };
  }

  function toolSplitEntry({ uid, parts } = {}) {
    const source = allEntries().find(entry => entry.uid === uid);
    if (!source) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    const list = Array.isArray(parts) ? parts.filter(part => part && String(part.comment || '').trim() && String(part.content || '').trim()) : [];
    if (list.length < 2) return { summary: '拆分失败', detail: 'parts 至少需要 2 个含标题和正文的条目' };
    const result = runCommand({ type: CommandType.SPLIT_ENTRY, sourceUid: uid, parts: list }, { label: '拆分 #' + uid });
    if (!result.changed) return { summary: '拆分失败', detail: '条目未发生变化' };
    renderSidebar();
    if (currentUid() === uid) {
      if (result.createdUids.length) selectEntry(result.createdUids[0]);
      else renderEditorEmpty();
    }
    scheduleSave();
    return {
      summary: '已拆分 #' + uid + ' → ' + result.createdUids.length + ' 条',
      detail: '新条目 UID: ' + result.createdUids.join('、') + '（可 undo_last 回退）',
      changes: [
        { type: 'split', uid, comment: source.comment || '', detail: '拆为 ' + result.createdUids.length + ' 条' },
        ...result.createdUids.slice(0, 12).map(newUid => ({ type: 'add', uid: newUid, comment: (allEntries().find(entry => entry.uid === newUid) || {}).comment || '' }))
      ]
    };
  }

  return {
    edit_entry: toolEdit,
    add_entry: toolAdd,
    add_entries: toolAddMany,
    delete_entry: toolDelete,
    delete_entries: toolDeleteMany,
    batch_edit: toolBatchEdit,
    replace_text: toolReplaceText,
    manage_keys: toolManageKeys,
    move_entry: toolMoveEntry,
    toggle_entry: toolToggle,
    reorder_entry: toolReorder,
    duplicate_entry: toolDuplicate,
    merge_entries: toolMergeEntries,
    split_entry: toolSplitEntry
  };
}
