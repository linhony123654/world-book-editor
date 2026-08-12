import assert from 'node:assert/strict';
import test from 'node:test';

import { planWorldbookEntry } from '../modules/worldbook-intelligence/index.js';

const existingEntries = [
  { uid: 1, comment: '王都', key: ['王都'], content: '王国首都。', constant: false }
];

test('plans a location entry with location template and keyword trigger settings', () => {
  const draft = planWorldbookEntry({
    userRequest: '写一个王都的贫民区，叫灰渠街',
    entries: existingEntries
  });

  assert.equal(draft.semanticType, 'location');
  assert.equal(draft.functionType, 'keyword_trigger');
  assert.equal(draft.fields.constant, false);
  assert.equal(draft.fields.position, 0);
  assert.ok(draft.content.includes('位置与功能'));
  assert.ok(draft.fields.key.includes('灰渠街'));
});

test('fills template sections with usable draft text when AI only provides a request', () => {
  const draft = planWorldbookEntry({
    userRequest: '写一个被贵族遗忘的地下诊所，服务对象是灰渠街穷人，隐藏风险是被王都药监追查',
    semanticType: 'location',
    functionType: 'plot_hook',
    templateSections: ['入口伪装', '服务对象', '隐藏风险'],
    entries: existingEntries
  });

  assert.match(draft.content, /入口伪装：.+/);
  assert.match(draft.content, /服务对象：.+/);
  assert.match(draft.content, /隐藏风险：.+/);
  assert.equal(draft.content.includes('服务对象：\n'), false);
  assert.equal(draft.content.includes('隐藏风险：\n'), false);
});

test('keeps complete AI supplied content unchanged', () => {
  const content = '入口伪装：旧药铺后门只在雨夜开。\n服务对象：灰渠街穷人与逃亡工匠。\n隐藏风险：王都药监已经安插线人。';
  const draft = planWorldbookEntry({
    userRequest: '写地下诊所',
    semanticType: 'location',
    templateSections: ['入口伪装', '服务对象', '隐藏风险'],
    content,
    entries: existingEntries
  });

  assert.equal(draft.content, content);
});

test('uses writing template reference when no explicit template sections are supplied', () => {
  const draft = planWorldbookEntry({
    userRequest: '写一个下城区秘密诊所',
    semanticType: 'location',
    functionType: 'plot_hook',
    writingTemplate: '入口伪装：说明外部怎么隐藏。\n服务对象：说明谁会来。\n隐藏风险：说明会被谁追查。',
    entries: existingEntries
  });

  // 无正文时，请求原文作为首段；缺失段落留空，不生成指令性占位
  assert.match(draft.content, /入口伪装：写一个下城区秘密诊所/);
  assert.ok(!draft.content.includes('服务对象：'));
  assert.ok(!draft.content.includes('需要写成'));
  assert.deepEqual(draft.templateSections, ['入口伪装', '服务对象', '隐藏风险']);
});

test('plans a world rule as a constant background entry', () => {
  const draft = planWorldbookEntry({
    userRequest: '整个世界都有魔法代价，帮我写进世界书',
    entries: existingEntries
  });

  assert.equal(draft.semanticType, 'rule');
  assert.equal(draft.functionType, 'constant_background');
  assert.equal(draft.fields.constant, true);
  assert.deepEqual(draft.fields.key, []);
  assert.ok(draft.content.includes('规则'));
});

test('warns about short or duplicate trigger keywords', () => {
  const draft = planWorldbookEntry({
    title: '王都',
    semanticType: 'location',
    functionType: 'keyword_trigger',
    key: ['王', '王都'],
    content: '王都设定。',
    entries: existingEntries
  });

  assert.ok(draft.checks.some(c => c.code === 'short_keyword'));
  assert.ok(draft.checks.some(c => c.code === 'duplicate_keyword'));
});

test('accepts AI supplied custom classification and template sections', () => {
  const draft = planWorldbookEntry({
    userRequest: '写一个被贵族遗忘的地下诊所',
    semanticType: 'location',
    functionType: 'plot_hook',
    customType: '地下据点',
    classificationReason: '它既是地点，也是剧情触发场景，重点是秘密服务与阶层矛盾。',
    templateSections: ['入口伪装', '内部气味与陈设', '服务对象', '交易规则', '隐藏风险'],
    fieldHints: { position: 4, depth: 3 },
    entries: existingEntries
  });

  assert.equal(draft.customType, '地下据点');
  assert.equal(draft.classificationReason, '它既是地点，也是剧情触发场景，重点是秘密服务与阶层矛盾。');
  assert.equal(draft.fields.position, 4);
  assert.equal(draft.fields.depth, 3);
  // 无正文时请求原文作为首段，缺失段落留空，不生成指令性占位
  assert.ok(draft.content.includes('入口伪装：'));
  assert.ok(!draft.content.includes('隐藏风险：'));
  assert.ok(!draft.content.includes('需要写成'));
});

test('uses AI decision matrix hints when supplied', () => {
  const draft = planWorldbookEntry({
    userRequest: '写一个会被地点递归带出的秘密医师传闻',
    semanticType: 'concept',
    functionType: 'recursive_detail',
    activationMode: 'recursive',
    recursionRole: 'delayed',
    priority: 'high',
    scope: 'plot',
    entries: existingEntries
  });

  assert.equal(draft.decision.activationMode, 'recursive');
  assert.equal(draft.fields.delayUntilRecursion, true);
  assert.equal(draft.fields.order, 280);
});
