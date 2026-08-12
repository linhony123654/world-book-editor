export const WRITING_TEMPLATE_FIELDS = [
  ['general', '通用模板'],
  ['character', '人物模板'],
  ['location', '地点模板'],
  ['organization', '组织模板'],
  ['rule', '规则模板'],
  ['plot_hook', '剧情钩子模板']
];

export function writingTemplateKey(bookId) {
  return 'wbe-writing-template:' + (bookId || 'unsaved');
}

export function createDefaultWritingTemplate(values = {}) {
  const out = {};
  for (const [key] of WRITING_TEMPLATE_FIELDS) {
    out[key] = normalizeText(values[key]);
  }
  return out;
}

export function loadWritingTemplate(storage, bookId) {
  try {
    const raw = storage.getItem(writingTemplateKey(bookId));
    return createDefaultWritingTemplate(raw ? JSON.parse(raw) : {});
  } catch {
    return createDefaultWritingTemplate();
  }
}

export function saveWritingTemplate(storage, bookId, template) {
  const normalized = createDefaultWritingTemplate(template || {});
  storage.setItem(writingTemplateKey(bookId), JSON.stringify(normalized));
  return normalized;
}

export function applyWritingTemplateUpdate(current, patch = {}, options = {}) {
  const base = createDefaultWritingTemplate(current || {});
  const mode = options.mode === 'append' ? 'append' : 'replace';
  for (const [key] of WRITING_TEMPLATE_FIELDS) {
    if (patch[key] === undefined || patch[key] === null) continue;
    const next = normalizeText(patch[key]);
    if (!next) continue;
    base[key] = mode === 'append' && base[key] ? base[key] + '\n' + next : next;
  }
  return base;
}

export function selectWritingTemplate(template, options = {}) {
  const data = createDefaultWritingTemplate(template || {});
  const parts = [];
  if (data.general) parts.push(data.general);
  const semanticKey = normalizeSemanticKey(options.semanticType);
  if (semanticKey && data[semanticKey]) parts.push(data[semanticKey]);
  const functionKey = normalizeFunctionKey(options.functionType);
  if (functionKey && data[functionKey]) parts.push(data[functionKey]);
  return parts.join('\n\n').trim();
}

export function formatWritingTemplateForTool(template, options = {}) {
  const data = createDefaultWritingTemplate(template || {});
  const selectedKeys = ['general'];
  const semanticKey = normalizeSemanticKey(options.semanticType);
  const functionKey = normalizeFunctionKey(options.functionType);
  if (semanticKey && !selectedKeys.includes(semanticKey)) selectedKeys.push(semanticKey);
  if (functionKey && !selectedKeys.includes(functionKey)) selectedKeys.push(functionKey);
  const sections = [];
  for (const key of selectedKeys) {
    if (!data[key]) continue;
    sections.push((labelForKey(key) || key) + ':\n' + data[key]);
  }
  return sections.join('\n\n').trim() || '当前世界书还没有配置写作模板。';
}

export function parseWritingTemplateDraft(text) {
  const raw = normalizeText(text);
  if (!raw) return createDefaultWritingTemplate();
  try {
    return createDefaultWritingTemplate(JSON.parse(raw));
  } catch {}
  const jsonText = extractJsonObject(raw);
  if (jsonText) {
    try { return createDefaultWritingTemplate(JSON.parse(jsonText)); } catch {}
  }

  const out = createDefaultWritingTemplate();
  const headingToField = new Map(WRITING_TEMPLATE_FIELDS.map(([field, label]) => [label, field]));
  let current = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    const heading = trimmed.replace(/[：:]+$/, '');
    if (headingToField.has(heading)) {
      current = headingToField.get(heading);
      continue;
    }
    const inline = trimmed.match(/^(.+?模板)[：:]\s*(.*)$/);
    if (inline && headingToField.has(inline[1].trim())) {
      current = headingToField.get(inline[1].trim());
      if (inline[2].trim()) out[current] += (out[current] ? '\n' : '') + inline[2].trim();
      continue;
    }
    if (current && trimmed) out[current] += (out[current] ? '\n' : '') + trimmed;
  }
  return createDefaultWritingTemplate(out);
}

export function buildWritingTemplateGenerationMessages({ bookName = '未命名', samples = '' } = {}) {
  const sys = '你是世界书“写作占位模板”设计器。你的任务不是写正式世界书条目，而是设计可复用的提示模板。模板应使用占位说明，例如“世界观核心：根据用户输入概括当前世界观，约150字”，而不是生成具体设定正文。只输出 JSON，不要 Markdown。字段必须是 general, character, location, organization, rule, plot_hook。';
  const usr = [
    '当前世界书名称：' + bookName,
    '',
    '你可以参考条目样本判断题材和口味，但不要把条目样本改写成正文，也不要编造新设定。',
    '请为每个字段生成“占位模板”，每行格式类似：',
    '世界观核心：根据用户输入描述当前世界观，约150字。',
    '外观/气质：根据用户输入补充可感知描写，约80字。',
    '触发条件：根据用户输入写清何时应激活该条目。',
    '',
    '每个模板应指导 AI 之后如何写条目：要求具体、可写入、不要空框架、不要直接照抄用户原话。',
    '',
    '条目样本（仅供判断风格，不要转写为正文）：',
    samples || '(暂无条目样本)'
  ].join('\n');
  return [
    { role: 'system', content: sys },
    { role: 'user', content: usr }
  ];
}

function extractJsonObject(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : '';
}

function normalizeText(value) {
  return value == null ? '' : String(value).trim().slice(0, 4000);
}

function normalizeSemanticKey(type) {
  const value = normalizeText(type);
  if (['character', 'location', 'organization', 'rule'].includes(value)) return value;
  return '';
}

function normalizeFunctionKey(type) {
  return normalizeText(type) === 'plot_hook' ? 'plot_hook' : '';
}

function labelForKey(key) {
  const found = WRITING_TEMPLATE_FIELDS.find(([field]) => field === key);
  return found ? found[1] : '';
}
