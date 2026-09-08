import { planWorldbookEntry } from '../../worldbook-intelligence/index.js';
import { TEMPLATES } from '../../worldbook-intelligence/templates.js';
import { applyDraftToEntry, createSmartDraftRecord, formatDecision } from '../../smart-draft.js';
import { selectWritingTemplate } from '../../writing-template.js';
import { CommandType } from '../../domain/worldbook-commands.js';
import { checkEntries } from './worldbook-read.js';

export const SMART_DRAFT_TOOL_NAMES = Object.freeze(['plan_smart_entry', 'create_smart_entry']);

export const SMART_DRAFT_PLACEHOLDER_RE = /需要写成|需要.*(?:设定|补充|描写)|围绕[^。]{0,12}补充|可直接进入对话上下文/;

export function smartDraftContentNeedsCompletion(draft) {
  const content = String(draft?.content || '').trim();
  const sections = Array.isArray(draft?.templateSections) && draft.templateSections.length
    ? draft.templateSections
    : (TEMPLATES[draft?.semanticType] || null);
  const covered = sections ? sections.filter(section => content.includes(section)).length : 0;
  return {
    incomplete:
      SMART_DRAFT_PLACEHOLDER_RE.test(content) ||
      content.length < 30 ||
      (sections && covered < Math.min(3, sections.length)),
    content,
    sections
  };
}

export function buildSmartDraftCompletionMessages(draft, state = smartDraftContentNeedsCompletion(draft)) {
  return [
    {
      role: 'system',
      content: '你是世界书设定写手。世界书条目应当像设定集词条：结构完整、信息分层、可考据、中立客观。正文必须覆盖四要素：人（职业/岗位/关键人物）、地（至少 2 个具体地点）、数（价格/时间/数量/比例）、则（流程/规则/代价），缺少要素是缺陷必须补全。人物/职业相关条目必须写详细外观：上衣款式材质颜色、下装、鞋、外搭、配饰、体貌特征，全部是旁观者可见的细节，禁止“穿着得体”等空泛词。篇幅按设定复杂度弹性——小条目 80–300 字，大卡可 500–1500 字甚至更长。根据条目主题和段落模板，把正文补全为可直接使用的完整设定：每个段落一行「段落名：内容」，内容要具体、有细节、可触发；已经写好的段落保留原文，只补缺失部分。严禁输出“需要写成…”“围绕…补充”等指令性文字，严禁空段落。'
    },
    {
      role: 'user',
      content: '条目主题：' + (draft?.title || '') +
        '\n段落模板：' + (state.sections ? state.sections.join('、') : '（按内容自然分段）') +
        '\n现有内容：\n' + (state.content || '（无）')
    }
  ];
}

export async function completeSmartDraftContent(draft, { completeAuxiliary, onError = () => {} } = {}) {
  const state = smartDraftContentNeedsCompletion(draft);
  if (!state.incomplete || typeof completeAuxiliary !== 'function') return draft;

  try {
    const text = await completeAuxiliary(buildSmartDraftCompletionMessages(draft, state));
    if (text && text.length > state.content.length * 0.6) draft.content = text;
  } catch (error) {
    onError(error);
  }
  return draft;
}

export function relatedEntriesAdvice(args, entries) {
  const list = (Array.isArray(args?.relatedEntries) ? args.relatedEntries : [])
    .filter(item => item && String(item.name || '').trim())
    .slice(0, 8);
  if (!list.length) return '';

  const existingNames = new Set((entries || []).map(entry => String(entry.comment || '').trim()));
  const missing = list.filter(item => !existingNames.has(String(item.name).trim()));
  if (!missing.length) return '\n关联词条：正文涉及 ' + list.length + ' 个实体均已有条目，无需新建。';
  return '\n关联词条建议（现有条目中未找到，可考虑创建）：\n' + missing.map(item =>
    '· ' + item.name + '（' + (item.type || '未知类型') + '）' + (item.note ? ' — ' + item.note : '')
  ).join('\n');
}

export function smartDraftDetail(draft, uid) {
  const checks = Array.isArray(draft?.checks) ? draft.checks : [];
  const checkText = checks.map(check => '[' + check.level + '] ' + check.message).join('\n');
  const fields = draft?.fields || {};
  const templateSections = Array.isArray(draft?.templateSections) ? draft.templateSections : [];
  return [
    uid != null ? 'UID: ' + uid : 'UID: (待创建)',
    '标题: ' + (draft?.title || ''),
    '语义类型: ' + (draft?.semanticType || ''),
    '自定义分类: ' + (draft?.customType || '(无)'),
    '功能类型: ' + (draft?.functionType || ''),
    '分类理由: ' + (draft?.classificationReason || '按请求与默认规则判断'),
    '设置判断: ' + formatDecision(draft?.decision),
    '模板段落: ' + (templateSections.length ? templateSections.join('、') : '内置 ' + (draft?.semanticType || '') + ' 模板'),
    '设置: constant=' + fields.constant + ', position=' + fields.position + ', depth=' + fields.depth + ', order=' + fields.order,
    '关键词: ' + ((fields.key && fields.key.length) ? fields.key.join('、') : '(无)'),
    '检查:\n' + checkText,
    '正文:\n' + (draft?.content || '')
  ].join('\n');
}

export function newEntryHealthDetail(uid, draft, entries) {
  const lines = [];
  for (const check of (draft?.checks || [])) {
    if (check.level === 'warning' || check.level === 'danger') lines.push('[' + check.level + '] ' + check.message);
  }
  const report = checkEntries(entries || []);
  for (const line of String(report.detail || '').split('\n')) {
    if (line.includes('#' + uid)) lines.push(line);
  }
  if (!lines.length) return '\n新条目体检：未发现风险。';
  return '\n新条目体检：\n' + lines.join('\n');
}

export function createSmartDraftOrchestrator({
  getEntries,
  getWritingTemplate,
  completeAuxiliary,
  nextUid,
  createEntry,
  runCommand,
  renderSidebar = () => {},
  scheduleSave = () => {},
  setActiveDraft = () => {},
  showDraftPreview = () => {},
  onCompletionError = () => {}
} = {}) {
  const allEntries = () => getEntries();

  function withWritingTemplate(args) {
    const input = args || {};
    const template = typeof getWritingTemplate === 'function' ? getWritingTemplate() : {};
    return {
      ...input,
      entries: allEntries(),
      writingTemplate: input.writingTemplate || selectWritingTemplate(template, input)
    };
  }

  async function prepareDraft(args) {
    const draft = planWorldbookEntry(withWritingTemplate(args));
    return completeSmartDraftContent(draft, {
      completeAuxiliary,
      onError: onCompletionError
    });
  }

  function commitDraft(draft) {
    const uid = nextUid();
    const entry = createEntry(uid);
    applyDraftToEntry(entry, draft);
    const result = runCommand({ type: CommandType.CREATE_ENTRY, entry }, { label: '智能新增条目' });
    if (!result.changed) {
      return { summary: '智能创建失败', detail: '条目未发生写入', changes: [], uid: null };
    }
    renderSidebar();
    scheduleSave();
    return {
      summary: '已智能创建 #' + uid + '「' + draft.title + '」',
      detail: smartDraftDetail(draft, uid),
      changes: [{ type: 'add', uid, comment: draft.title || '', detail: '智能创建' }],
      uid
    };
  }

  async function createSmartEntry(args = {}) {
    const completed = await prepareDraft(args);
    const result = commitDraft(completed);
    const related = relatedEntriesAdvice(args, allEntries());
    if (related) result.detail += related;
    if (result.uid != null) result.detail += newEntryHealthDetail(result.uid, completed, allEntries());
    return result;
  }

  async function planSmartEntry(args = {}) {
    const completed = await prepareDraft(args);
    const record = createSmartDraftRecord(completed);
    setActiveDraft(record);
    showDraftPreview(record);
    const detail = smartDraftDetail(completed, null) + relatedEntriesAdvice(args, allEntries());
    return {
      summary: '已生成智能条目预览「' + completed.title + '」，请在弹窗中确认',
      stop: true,
      detail: detail + '\n\n草稿 ID: ' + record.id + '\n请在弹窗中确认创建或取消，本回合已停止。'
    };
  }

  return {
    handlers: {
      plan_smart_entry: planSmartEntry,
      create_smart_entry: createSmartEntry
    },
    prepareDraft,
    commitDraft
  };
}
