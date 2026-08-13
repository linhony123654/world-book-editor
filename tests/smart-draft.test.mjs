import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDraftToEntry, createSmartDraftRecord, draftDisplayRows } from '../public/modules/smart-draft.js';

const draft = {
  title: '灰渠街地下诊所',
  semanticType: 'location',
  customType: '地下据点',
  functionType: 'plot_hook',
  classificationReason: '这是场景触发型地点。',
  decision: { activationMode: 'keyword', insertionMode: 'depth', priority: 'high', scope: 'scene' },
  templateSections: ['入口伪装', '隐藏风险'],
  fields: { key: ['灰渠街地下诊所'], constant: false, position: 4, depth: 4, order: 280, sticky: 3 },
  checks: [{ level: 'ok', message: '关键词正常。' }],
  content: '入口伪装：旧药铺\n隐藏风险：贵族追查'
};

test('creates pending smart draft record', () => {
  const record = createSmartDraftRecord(draft, 'draft-1');

  assert.equal(record.id, 'draft-1');
  assert.equal(record.draft.title, '灰渠街地下诊所');
  assert.equal(typeof record.createdAt, 'number');
});

test('applies smart draft to an entry object', () => {
  const entry = { uid: 7, key: [], content: '', comment: '' };

  applyDraftToEntry(entry, draft);

  assert.equal(entry.comment, '灰渠街地下诊所');
  assert.equal(entry.position, 4);
  assert.equal(entry.depth, 4);
  assert.equal(entry.order, 280);
  assert.deepEqual(entry.key, ['灰渠街地下诊所']);
  assert.equal(entry.extensions.wbe.semanticType, 'location');
  assert.equal(entry.extensions.wbe.customType, '地下据点');
  assert.deepEqual(entry.extensions.wbe.decision, draft.decision);
});

test('builds display rows for preview modal', () => {
  const rows = draftDisplayRows(draft);

  assert.ok(rows.some(r => r.label === '语义类型' && r.value === 'location'));
  assert.ok(rows.some(r => r.label === '自定义分类' && r.value === '地下据点'));
  assert.ok(rows.some(r => r.label === '设置判断' && r.value.includes('keyword')));
});
