export const WRITING_TEMPLATE_FIELDS = [
  ['general', '通用模板'],
  ['character', '人物模板'],
  ['location', '地点模板'],
  ['organization', '组织模板'],
  ['rule', '规则模板'],
  ['plot_hook', '剧情钩子模板']
];

// 内置默认模板：世界书未配置模板时自动使用（占位式指导，AI 据此写正式条目）
export const DEFAULT_WRITING_TEMPLATE = {
  general: [
    '世界观核心：根据用户输入概括当前世界观的核心设定与基调，约150字。点明时代背景、整体氛围与独特之处。',
    '世界运行机制：根据用户输入列出该世界区别于现实的关键运行机制，3-5条，每条一句话，具体可执行。',
    '社会结构：根据用户输入描述主要社会分层、权力结构与各阶层关系，约100字。',
    '地理概要：根据用户输入概括主要地理分区与各地特征，约100字。',
    '历史脉络：根据用户输入概述影响当下的关键历史事件与遗留影响，约120字。',
    '基调约束：明确本书叙事基调（严肃/诙谐/黑暗/冒险等），并写明写作时应避免的违和点。'
  ].join('\n'),
  character: [
    '基本信息：姓名、年龄、身份/职业、所属阵营或势力，各占一行。',
    '外观描写：外貌特征、标志性装束、气质印象，约80字，可感知可想象。',
    '性格核心：用3-5个词概括性格，并各配一句行为表现（面对压力时/面对利益时/对待弱者时）。',
    '背景故事：出身、关键经历、改变人生的节点，约120字。',
    '人际关系：与主角或其他关键角色的关系与态度，列出姓名+关系+现状。',
    '动机与目标：当前最想要什么、为什么、会为此做什么（区分长期与短期）。',
    '说话风格：口头禅、语速、用词习惯、对特定话题的反应。',
    '触发与使用：什么情境下该条目被读取，AI 扮演时应如何运用以上信息（保持一致性、不重复播报设定）。'
  ].join('\n'),
  location: [
    '定位：地点名称、所属区域、在剧情中的角色（主场/路过/禁地等）。',
    '外观描写：建筑风格、色调、标志物、第一眼印象，约100字。',
    '氛围与细节：不同时段（白天/夜晚/特殊事件时）的氛围差异；独特声响、气味、光线。',
    '社会生态：常驻人群、势力控制、秩序与混乱程度。',
    '关键设施：有叙事价值的场所或物品清单（暗道、公告栏、禁入区等）。',
    '事件与传闻：发生在该地的知名事件、民间传闻、禁忌话题。',
    '触发与使用：关键词触发场景；AI 描述时应优先带出哪些细节、避免直接总结设定。'
  ].join('\n'),
  organization: [
    '组织概览：名称、性质（官方/宗教/商会/秘密结社等）、规模与覆盖范围。',
    '宗旨与铁律：公开宗旨、内部铁律、违反的后果，各1-2句。',
    '结构：层级、领袖、关键职位与代表人物（姓名+职责）。',
    '成员：招收条件、常见职业、成员待遇与代价。',
    '秘密与冲突：对外隐瞒的真相、内部派系、与其他组织的敌对或合作。',
    '行事风格：对外作风（强硬/圆滑/隐秘）、标志性手段。',
    '触发与使用：成员登场、组织相关事件触发时如何运用以上信息。'
  ].join('\n'),
  rule: [
    '名称与类别：规则名与所属体系（魔法/科技/社会禁忌等），说明适用边界。',
    '核心机制：规则如何运作，3-5条，每条约一句话，具体可执行。',
    '限制与代价：使用限制、反噬、资源消耗、违反后果。',
    '例外与漏洞：可被利用的例外情况、边界模糊处。',
    '体系联动：与其它规则或体系的关联（冲突或互补）。',
    '触发与使用：AI 描述相关现象时必须遵守哪些点；如何自然地体现规则而非解释规则。'
  ].join('\n'),
  plot_hook: [
    '钩子类型：任务/谜团/冲突/危机/机遇等。',
    '触发情境：角色在什么条件下遇到该钩子（场景、事件、消息）。',
    '核心冲突：一句话点明冲突双方与张力来源。',
    '发展路径：2-3条可能的推进方向（明线/暗线/反转）。',
    '奖励与代价：完成或失败带来的后果、影响后续剧情的点。',
    '悬念设计：留下什么未解问题、何时回收伏笔。',
    '触发与使用：AI 在什么时机抛出钩子、抛出后如何保持悬念而不剧透。'
  ].join('\n')
};

export function writingTemplateKey(bookId) {
  return 'wbe-writing-template:' + (bookId || 'unsaved');
}

export function createDefaultWritingTemplate(values = {}) {
  const out = {};
  for (const [key] of WRITING_TEMPLATE_FIELDS) {
    out[key] = Object.prototype.hasOwnProperty.call(values, key)
      ? normalizeText(values[key])
      : DEFAULT_WRITING_TEMPLATE[key];
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

function emptyTemplate() {
  const out = {};
  for (const [key] of WRITING_TEMPLATE_FIELDS) out[key] = '';
  return out;
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

  // 先解析到空模板（避免把 AI 文本追加到默认模板上），缺失字段最后回退默认
  const out = emptyTemplate();
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
