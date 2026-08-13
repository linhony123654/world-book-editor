import { buildEntryDecision, mapDecisionToFields } from './decision-matrix.js';
import { resolveIntent, inferKeywords } from './intent.js';
import { buildCustomTemplatedContent, buildTemplatedContent, buildTemplateReferencedContent, extractTemplateSections } from './templates.js';
import { recommendSettings } from './settings-matrix.js';
import { checkTriggerSafety } from './trigger-safety.js';

export function planWorldbookEntry(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const intent = resolveIntent(input);
  const decision = buildEntryDecision({ ...input, ...intent });
  const fields = hasDecisionHints(input)
    ? mapDecisionToFields(decision)
    : recommendSettings(intent.semanticType, intent.functionType);
  Object.assign(fields, sanitizeFieldHints(input.fieldHints));
  fields.key = inferKeywords({ ...input, ...intent });
  if (typeof input.constant === 'boolean') fields.constant = input.constant;
  if (Array.isArray(input.key)) fields.key = input.key;

  const seed = input.content || input.userRequest || '';
  const templateSections = normalizeTemplateSections(input.templateSections, input.writingTemplate);
  const content = buildCustomTemplatedContent(templateSections, seed) ||
    buildTemplateReferencedContent(input.writingTemplate, seed, intent.semanticType) ||
    buildTemplatedContent(intent.semanticType, seed);
  const checks = checkTriggerSafety({ key: fields.key, entries });

  return {
    semanticType: intent.semanticType,
    functionType: intent.functionType,
    decision,
    customType: normalizeText(input.customType),
    classificationReason: normalizeText(input.classificationReason),
    templateSections,
    title: intent.title,
    content,
    fields,
    checks
  };
}

function normalizeTemplateSections(sections, writingTemplate) {
  const explicit = Array.isArray(sections) ? sections.map(s => String(s).trim()).filter(Boolean).slice(0, 12) : [];
  return explicit.length ? explicit : extractTemplateSections(writingTemplate);
}

function hasDecisionHints(input) {
  return ['activationMode', 'insertionMode', 'recursionRole', 'persistence', 'randomness', 'priority', 'scope', 'matchStrictness', 'reason']
    .some(k => input[k] !== undefined && input[k] !== null && input[k] !== '');
}

function normalizeText(value) {
  return value == null ? '' : String(value).trim();
}

function sanitizeFieldHints(hints) {
  if (!hints || typeof hints !== 'object') return {};
  const allowed = ['constant', 'selective', 'position', 'depth', 'order', 'probability'];
  const out = {};
  for (const k of allowed) {
    if (hints[k] !== undefined) out[k] = hints[k];
  }
  return out;
}
