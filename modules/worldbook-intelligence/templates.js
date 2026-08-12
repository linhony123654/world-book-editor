const TEMPLATES = {
  character: ['身份', '外貌/气质', '性格', '能力/资源', '关系', '说话方式', '剧情钩子', '限制'],
  location: ['位置与功能', '视觉印象', '居民/势力', '重要地点', '危险与规则', '可触发剧情', '与其他地点的关系'],
  organization: ['公开身份', '真实目标', '组织结构', '资源与势力范围', '成员风格', '与其他势力关系', '弱点'],
  faction: ['立场', '核心利益', '代表人物', '资源', '敌友关系', '行动方式'],
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
  return sections.map((section, index) => {
    const text = extractSectionHint(section, body) || fallbackSectionText(section, body, type, index, hints[section]);
    return section + '：' + text;
  });
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
  if (index === 0 && body) return body;
  const subject = summarizeSeed(body) || '该条目';
  const hint = templateHint || sectionHints[section] || typeHints[type] || '围绕当前设定补充可触发、可执行的细节';
  return subject + '的' + section + '需要写成可直接进入对话上下文的设定：' + hint + '。';
}

function summarizeSeed(body) {
  if (!body) return '';
  return body
    .replace(/^请?帮?我?(?:写|新增|创建|补充|设计|生成)一个?/, '')
    .replace(/[。；;\n].*$/, '')
    .trim()
    .slice(0, 36);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const typeHints = {
  character: '包含身份、动机、资源、限制和与主线的关系',
  location: '包含可感知的环境、势力痕迹、进入条件和剧情用途',
  organization: '包含公开身份、真实目标、资源边界和弱点',
  event: '包含起因、关键变化、后果和后续钩子',
  rule: '包含适用范围、限制、代价和例外',
  item: '包含来源、功能、限制和持有关系',
  relationship: '包含双方表面关系、真实矛盾和变化触发点',
  style: '包含表达倾向、禁止事项和稳定口吻约束',
  concept: '包含定义、表现、使用场景和限制'
};

const sectionHints = {
  '入口伪装': '说明入口如何隐藏、谁能识别、误入者会看到什么',
  '内部气味与陈设': '写出能被角色感知的气味、光线、摆设和压迫感',
  '服务对象': '列出主要服务人群、他们为什么来、会付出什么代价',
  '交易规则': '说明交换条件、禁忌、违约后果和默认规矩',
  '隐藏风险': '写清会引爆冲突的追查者、证据、内鬼或时间限制',
  '剧情钩子': '给出能推动角色行动的线索、请求、威胁或选择',
  '可触发剧情': '给出进入场景后容易发生的事件和冲突',
  '与其他地点的关系': '说明交通、势力、传闻或资源上的连接'
};
