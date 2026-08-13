import { inferFunctionType, inferSemanticType, SEMANTIC_TYPES, FUNCTION_TYPES } from './taxonomy.js';

function pickQuoted(text) {
  const m = String(text || '').match(/[「《“"]([^」》”"]{2,40})[」》”"]/);
  return m ? m[1].trim() : '';
}

function inferTitle(text, semanticType) {
  const quoted = pickQuoted(text);
  if (quoted) return quoted;
  const named = String(text || '').match(/叫([^，。,。\s]{2,20})/);
  if (named) return named[1].trim();
  if (semanticType === 'rule') return '世界规则';
  if (semanticType === 'location') return '未命名地点';
  if (semanticType === 'character') return '未命名人物';
  if (semanticType === 'organization') return '未命名组织';
  if (semanticType === 'law') return '未命名律法';
  if (semanticType === 'history') return '历史沿革';
  if (semanticType === 'geography') return '地理志';
  if (semanticType === 'economy') return '经济体系';
  if (semanticType === 'magic') return '超凡体系';
  if (semanticType === 'culture') return '文化与习俗';
  return '未命名条目';
}

export function resolveIntent(input) {
  const request = String(input.userRequest || '');
  const semanticType = SEMANTIC_TYPES.includes(input.semanticType) ? input.semanticType : inferSemanticType(request + ' ' + (input.title || ''));
  const functionType = FUNCTION_TYPES.includes(input.functionType) ? input.functionType : inferFunctionType(request, semanticType);
  const title = (input.title && String(input.title).trim()) || inferTitle(request, semanticType);
  return { semanticType, functionType, title };
}

export function inferKeywords({ title, semanticType, functionType, key }) {
  if (Array.isArray(key)) return key.map(k => String(k).trim()).filter(Boolean);
  if (functionType === 'constant_background') return [];
  const keys = [];
  if (title && !/^未命名|世界规则$/.test(title)) keys.push(title);
  if (semanticType === 'location' && title.includes('·')) keys.push(title.split('·').pop());
  return [...new Set(keys)];
}
