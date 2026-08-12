import { FUNCTION_TYPES, SEMANTIC_TYPES } from './taxonomy.js';

const ACTIVATION_MODES = ['always', 'keyword', 'selective', 'recursive', 'manual'];
const INSERTION_MODES = ['lore', 'depth', 'example', 'author_note', 'outlet'];
const RECURSION_ROLES = ['none', 'entry', 'bridge', 'terminal', 'isolated', 'delayed'];
const PERSISTENCE = ['none', 'sticky', 'cooldown', 'delayed'];
const RANDOMNESS = ['none', 'rare', 'occasional', 'weighted'];
const PRIORITIES = ['low', 'normal', 'high', 'critical'];
const SCOPES = ['global', 'character', 'scene', 'plot', 'style', 'safety'];
const MATCH_STRICTNESS = ['loose', 'normal', 'strict', 'exact'];

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function buildEntryDecision(input = {}) {
  const semanticType = pick(input.semanticType, SEMANTIC_TYPES, 'concept');
  const functionType = pick(input.functionType, FUNCTION_TYPES, 'keyword_trigger');
  return {
    semanticType,
    customType: input.customType ? String(input.customType).trim() : '',
    functionType,
    activationMode: pick(input.activationMode, ACTIVATION_MODES, functionType === 'constant_background' ? 'always' : 'keyword'),
    insertionMode: pick(input.insertionMode, INSERTION_MODES, functionType === 'plot_hook' || functionType === 'voice_constraint' ? 'depth' : 'lore'),
    recursionRole: pick(input.recursionRole, RECURSION_ROLES, 'none'),
    persistence: pick(input.persistence, PERSISTENCE, 'none'),
    randomness: pick(input.randomness, RANDOMNESS, 'none'),
    priority: pick(input.priority, PRIORITIES, 'normal'),
    scope: pick(input.scope, SCOPES, semanticType === 'rule' ? 'global' : 'scene'),
    matchStrictness: pick(input.matchStrictness, MATCH_STRICTNESS, 'normal'),
    reason: input.reason ? String(input.reason).trim() : ''
  };
}

export function mapDecisionToFields(decision) {
  const d = buildEntryDecision(decision);
  const fields = {
    constant: false,
    selective: false,
    selectiveLogic: 0,
    position: 0,
    depth: 4,
    order: orderFor(d.priority),
    probability: probabilityFor(d.randomness),
    sticky: 0,
    cooldown: 0,
    delay: 0,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null
  };

  applyActivation(fields, d);
  applyInsertion(fields, d);
  applyRecursion(fields, d);
  applyPersistence(fields, d);
  applyStrictness(fields, d);
  return fields;
}

function orderFor(priority) {
  return { low: 120, normal: 190, high: 280, critical: 420 }[priority] || 190;
}

function probabilityFor(randomness) {
  return { none: 100, rare: 10, occasional: 35, weighted: 100 }[randomness] || 100;
}

function applyActivation(fields, d) {
  if (d.activationMode === 'always') fields.constant = true;
  if (d.activationMode === 'selective') {
    fields.selective = true;
    fields.selectiveLogic = 0;
  }
  if (d.activationMode === 'recursive') fields.delayUntilRecursion = true;
  if (d.functionType === 'constant_background') fields.constant = true;
}

function applyInsertion(fields, d) {
  if (d.insertionMode === 'depth') {
    fields.position = 4;
    fields.depth = depthFor(d);
  } else if (d.insertionMode === 'lore') {
    fields.position = d.scope === 'global' ? 0 : 1;
  } else if (d.insertionMode === 'example') {
    fields.position = 5;
  } else if (d.insertionMode === 'author_note') {
    fields.position = 2;
  }
}

function depthFor(d) {
  if (d.scope === 'style' || d.functionType === 'voice_constraint' || d.scope === 'safety') return 1;
  if (d.scope === 'character') return 2;
  if (d.scope === 'scene') return 4;
  if (d.scope === 'plot') return 5;
  return 4;
}

function applyRecursion(fields, d) {
  if (d.recursionRole === 'terminal') fields.preventRecursion = true;
  if (d.recursionRole === 'isolated') fields.excludeRecursion = true;
  if (d.recursionRole === 'delayed') fields.delayUntilRecursion = true;
  if (d.functionType === 'voice_constraint' || d.scope === 'safety') fields.preventRecursion = true;
}

function applyPersistence(fields, d) {
  if (d.persistence === 'sticky') {
    fields.sticky = d.scope === 'scene' ? 3 : 2;
    fields.cooldown = d.randomness === 'none' ? 2 : 4;
  } else if (d.persistence === 'cooldown') {
    fields.cooldown = d.randomness === 'rare' ? 8 : 4;
  } else if (d.persistence === 'delayed') {
    fields.delay = d.scope === 'plot' ? 4 : 2;
  }
}

function applyStrictness(fields, d) {
  if (d.matchStrictness === 'strict') {
    fields.selective = true;
    fields.selectiveLogic = 0;
  } else if (d.matchStrictness === 'exact') {
    fields.selective = true;
    fields.selectiveLogic = 1;
    fields.caseSensitive = true;
    fields.matchWholeWords = true;
  } else if (d.matchStrictness === 'loose') {
    fields.matchWholeWords = false;
  }
}
