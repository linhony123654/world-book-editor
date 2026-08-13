import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEntryDecision, mapDecisionToFields } from '../public/modules/worldbook-intelligence/decision-matrix.js';

test('maps a scene plot hook decision to depth insertion with sticky timing', () => {
  const decision = buildEntryDecision({
    semanticType: 'location',
    functionType: 'plot_hook',
    customType: '地下据点',
    activationMode: 'keyword',
    insertionMode: 'depth',
    recursionRole: 'bridge',
    persistence: 'sticky',
    randomness: 'none',
    priority: 'high',
    scope: 'scene',
    matchStrictness: 'normal'
  });

  const fields = mapDecisionToFields(decision);

  assert.equal(fields.constant, false);
  assert.equal(fields.position, 4);
  assert.equal(fields.depth, 4);
  assert.equal(fields.order, 280);
  assert.equal(fields.sticky, 3);
  assert.equal(fields.cooldown, 2);
  assert.equal(fields.preventRecursion, false);
});

test('maps global critical rule to constant background with recursion stop', () => {
  const decision = buildEntryDecision({
    semanticType: 'rule',
    functionType: 'constant_background',
    activationMode: 'always',
    insertionMode: 'lore',
    recursionRole: 'terminal',
    priority: 'critical',
    scope: 'global'
  });

  const fields = mapDecisionToFields(decision);

  assert.equal(fields.constant, true);
  assert.equal(fields.position, 0);
  assert.equal(fields.order, 420);
  assert.equal(fields.preventRecursion, true);
  assert.equal(fields.excludeRecursion, false);
});

test('maps delayed recursive detail to recursion-only entry', () => {
  const decision = buildEntryDecision({
    semanticType: 'concept',
    functionType: 'recursive_detail',
    activationMode: 'recursive',
    recursionRole: 'delayed',
    priority: 'normal'
  });

  const fields = mapDecisionToFields(decision);

  assert.equal(fields.constant, false);
  assert.equal(fields.delayUntilRecursion, true);
  assert.equal(fields.order, 190);
});

test('normalizes unknown decision values to conservative defaults', () => {
  const decision = buildEntryDecision({
    semanticType: 'unknown',
    activationMode: 'weird',
    priority: 'wild'
  });

  assert.equal(decision.semanticType, 'concept');
  assert.equal(decision.activationMode, 'keyword');
  assert.equal(decision.priority, 'normal');
});
