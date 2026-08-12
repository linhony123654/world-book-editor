export function createSmartDraftRecord(draft, id) {
  return {
    id: id || ('draft-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)),
    draft,
    createdAt: Date.now()
  };
}

export function applyDraftToEntry(entry, draft) {
  entry.comment = draft.title || entry.comment || '';
  entry.content = draft.content || entry.content || '';
  for (const [k, v] of Object.entries(draft.fields || {})) {
    if (k === 'uid' || v === undefined) continue;
    entry[k] = v;
  }
  entry.extensions = entry.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
  entry.extensions.wbe = entry.extensions.wbe && typeof entry.extensions.wbe === 'object' ? entry.extensions.wbe : {};
  Object.assign(entry.extensions.wbe, {
    semanticType: draft.semanticType || '',
    customType: draft.customType || '',
    functionType: draft.functionType || '',
    classificationReason: draft.classificationReason || '',
    decision: draft.decision || null,
    templateSections: draft.templateSections || [],
    checks: draft.checks || []
  });
  return entry;
}

export function draftDisplayRows(draft) {
  return [
    ['标题', draft.title],
    ['语义类型', draft.semanticType],
    ['自定义分类', draft.customType || '(无)'],
    ['功能类型', draft.functionType],
    ['分类理由', draft.classificationReason || '按请求与默认规则判断'],
    ['设置判断', formatDecision(draft.decision)],
    ['模板段落', draft.templateSections && draft.templateSections.length ? draft.templateSections.join('、') : '内置 ' + draft.semanticType + ' 模板'],
    ['字段设置', formatFields(draft.fields)],
    ['关键词', draft.fields && draft.fields.key && draft.fields.key.length ? draft.fields.key.join('、') : '(无)']
  ].map(([label, value]) => ({ label, value: String(value == null ? '' : value) }));
}

export function formatDecision(decision) {
  if (!decision) return '默认矩阵';
  const parts = [
    decision.activationMode,
    decision.insertionMode,
    decision.recursionRole,
    decision.persistence,
    decision.randomness,
    decision.priority,
    decision.scope,
    decision.matchStrictness
  ].filter(Boolean);
  return parts.join(' / ') + (decision.reason ? '；' + decision.reason : '');
}

function formatFields(fields = {}) {
  const names = ['constant', 'position', 'depth', 'order', 'probability', 'sticky', 'cooldown', 'delay', 'excludeRecursion', 'preventRecursion', 'delayUntilRecursion'];
  return names.filter(k => fields[k] !== undefined).map(k => k + '=' + fields[k]).join(', ');
}
