export const SEMANTIC_TYPES = [
  'character', 'location', 'organization', 'faction', 'event', 'rule', 'item', 'concept', 'relationship', 'style'
];

export const FUNCTION_TYPES = [
  'keyword_trigger', 'constant_background', 'recursive_detail', 'voice_constraint', 'plot_hook', 'hidden_fact', 'conflict_fix'
];

const SEMANTIC_HINTS = [
  ['location', ['地点', '城市', '城区', '街', '区', '城', '村', '镇', '港', '学院', '王都', '贫民区', '秘境']],
  ['organization', ['组织', '教会', '公会', '公司', '机构', '军团', '议会', '学院', '家族']],
  ['faction', ['阵营', '派系', '势力', '党派']],
  ['character', ['人物', '角色', '人设', '主角', '反派', '导师', '少女', '少年', '队长']],
  ['rule', ['规则', '法则', '整个世界', '世界都有', '必须', '禁止', '代价', '魔法代价']],
  ['event', ['事件', '战争', '仪式', '灾难', '案件', '节日', '历史']],
  ['item', ['物品', '道具', '武器', '药剂', '神器', '遗物']],
  ['relationship', ['关系', '盟友', '仇敌', '婚约', '师徒']],
  ['style', ['文风', '口吻', '语气', '叙事', '风格']],
  ['concept', ['术语', '概念', '名词', '制度']]
];

export function inferSemanticType(text) {
  const src = String(text || '').toLowerCase();
  for (const [type, hints] of SEMANTIC_HINTS) {
    if (hints.some(h => src.includes(h.toLowerCase()))) return type;
  }
  return 'concept';
}

export function inferFunctionType(text, semanticType) {
  const src = String(text || '');
  if (semanticType === 'rule' || semanticType === 'style' || /常驻|全局|整个世界|始终|必须/.test(src)) return 'constant_background';
  if (/隐藏|秘密|真相/.test(src)) return 'hidden_fact';
  if (/剧情|钩子|任务|冲突/.test(src)) return 'plot_hook';
  if (/口吻|说话|语气/.test(src)) return 'voice_constraint';
  return 'keyword_trigger';
}
