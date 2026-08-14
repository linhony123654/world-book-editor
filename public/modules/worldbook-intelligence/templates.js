export const TEMPLATES = {
  character: ['身份', '外貌/气质', '性格', '能力/资源', '关系', '说话方式', '剧情钩子', '限制'],
  profession: ['职业定义与入门', '工作内容与日常', '技能与资质', '收入与等级', '服装与装备', '工作地点与时间', '行业规则与禁忌', '与其他职业/组织的关系', '现状与变化'],
  location: ['位置与功能', '视觉印象', '居民/势力', '重要地点', '危险与规则', '可触发剧情', '与其他地点的关系'],
  geography: ['区域概貌', '地形与气候', '重要地标', '资源与产出', '交通与联系', '危险区域', '对文明的影响'],
  organization: ['公开身份', '真实目标', '组织结构', '资源与势力范围', '成员风格', '与其他势力关系', '弱点'],
  faction: ['立场', '核心利益', '代表人物', '资源', '敌友关系', '行动方式'],
  law: ['立法目的', '适用范围', '核心条文', '违者处罚', '执行与豁免', '历史由来', '常见纠纷与剧情钩子'],
  history: ['时代背景', '关键事件', '重要人物/势力', '转折点', '遗留影响', '可触发的历史谜团'],
  economy: ['经济形态', '货币与交换', '主要产业', '贸易路线', '贫富结构', '经济冲突点'],
  magic: ['体系原理', '获取与修炼', '类别/等级', '代价与限制', '禁忌', '对世界的影响', '剧情用途'],
  culture: ['信仰与神明', '节日与仪式', '社会习俗', '禁忌', '艺术与传说', '文化冲突点'],
  event: ['时间与背景', '起因', '经过', '结果', '相关人物/势力', '后续影响'],
  rule: ['规则', '适用范围', '代价/限制', '例外情况', '剧情影响'],
  item: ['外观', '来源', '功能', '限制/代价', '持有者', '剧情用途'],
  concept: ['定义', '表现', '使用场景', '相关人物/地点/组织', '限制'],
  relationship: ['关系双方', '表面关系', '真实矛盾', '关键历史', '剧情变化点'],
  style: ['约束对象', '表达方式', '禁止事项', '示例倾向']
};

export function buildTemplatedContent(type, seedContent) {
  const body = String(seedContent || '').trim();
  const sections = TEMPLATES[type] || TEMPLATES.concept;
  if (body && sections.some(s => body.includes(s + '：'))) return body;
  return fillSections(sections, body, type).join('\n');
}

export function buildCustomTemplatedContent(sections, seedContent) {
  const clean = Array.isArray(sections) ? sections.map(s => String(s).trim()).filter(Boolean).slice(0, 12) : [];
  if (!clean.length) return '';
  const body = String(seedContent || '').trim();
  if (body && clean.some(s => body.includes(s + '：'))) return body;
  return fillSections(clean, body, 'concept').join('\n');
}

export function extractTemplateSections(templateText) {
  const text = String(templateText || '').trim();
  if (!text) return [];
  const sections = [];
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^([^：:]{2,24})[：:]/);
    if (!match) continue;
    const name = match[1].trim();
    if (!name || name.includes('模板') || sections.includes(name)) continue;
    sections.push(name);
    if (sections.length >= 12) break;
  }
  return sections;
}

export function buildTemplateReferencedContent(templateText, seedContent, type) {
  const sections = extractTemplateSections(templateText);
  if (!sections.length) return '';
  const body = String(seedContent || '').trim();
  if (body && sections.some(s => body.includes(s + '：'))) return body;
  return fillSections(sections, body, type || 'concept', parseTemplateHints(templateText)).join('\n');
}

function fillSections(sections, body, type, hints = {}) {
  const out = [];
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const text = extractSectionHint(section, body) || fallbackSectionText(section, body, type, index, hints[section]);
    if (text) out.push(section + '：' + text);
  }
  return out;
}

function parseTemplateHints(templateText) {
  const hints = {};
  for (const line of String(templateText || '').split('\n')) {
    const match = line.trim().match(/^([^：:]{2,24})[：:]\s*(.+)$/);
    if (!match) continue;
    const name = match[1].trim();
    const text = match[2].trim();
    if (name && text && !name.includes('模板')) hints[name] = text;
  }
  return hints;
}

function extractSectionHint(section, body) {
  if (!body) return '';
  const normalized = body.replace(/[，。；;\n]+/g, '，');
  const escaped = escapeRegExp(section);
  const patterns = [
    new RegExp(escaped + '(?:是|为|：|:)([^，。；;\n]+)'),
    new RegExp(escaped + '[^，。；;\n]*(?:是|为|：|:)([^，。；;\n]+)')
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return '';
}

function fallbackSectionText(section, body, type, index, templateHint) {
  // 无段落结构时，AI 原文作为首段；其余缺失段落留空，由 AI 补全流程填充，
  // 避免把指令性占位（如「需要写成…」）写进条目
  if (index === 0 && body) return body;
  return '';
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
