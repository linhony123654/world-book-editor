import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyEntryFilter,
  searchEntries,
  findDuplicates,
  checkEntries,
  testTriggers,
  bookInfo
} from '../public/modules/ai/tools/worldbook-read.js';

const entries = [
  { uid: 1, comment: '王城夜禁', content: '王城每日戌时起宵禁。', key: ['夜禁', '王城'], constant: false, disable: false, depth: 4, order: 100, extensions: { wbe: { semanticType: 'law' } } },
  { uid: 2, comment: '巡夜禁军', content: '巡夜禁军负责巡逻。', key: ['夜禁', '禁军'], constant: false, disable: false, depth: 2, order: 50, extensions: { wbe: { semanticType: 'organization' } } },
  { uid: 3, comment: '世界基调', content: '这是常驻背景。', key: [], constant: true, disable: false, depth: 1, order: 10 },
  { uid: 4, comment: '废弃设定', content: '', key: [], constant: false, disable: true, depth: 4, order: 100 }
];

test('entry filter and semantic search preserve existing query behavior', () => {
  assert.deepEqual(applyEntryFilter(entries, { disable: true }).map(e => e.uid), [4]);
  const result = searchEntries(entries, { query: '夜禁', type: 'law' });
  assert.equal(result.summary, '找到 1 条');
  assert.match(result.detail, /#1 王城夜禁/);
});

test('shared-key diagnostics preserve legacy two-sided reporting', () => {
  const result = checkEntries(entries);
  const shared = result.detail.split('\n').filter(line => line.includes('[关键词共享]') && line.includes('夜禁'));
  assert.equal(shared.length, 2);
  assert.ok(shared.some(line => line.includes('#1「王城夜禁」') && line.includes('#2')));
  assert.ok(shared.some(line => line.includes('#2「巡夜禁军」') && line.includes('#1')));
});

test('trigger simulation keeps depth/order injection ordering', () => {
  const result = testTriggers(entries, { text: '王城今晚执行夜禁，禁军封锁街道。' });
  assert.match(result.summary, /命中 3 条/);
  const lines = result.detail.split('\n').slice(1);
  assert.match(lines[0], /#3 世界基调/);
  assert.match(lines[1], /#2 巡夜禁军/);
  assert.match(lines[2], /#1 王城夜禁/);
});

test('duplicate finder and book info are deterministic', () => {
  const duplicateInput = [
    { uid: 7, comment: '银塔', content: '相同正文', key: ['银塔', '法师'] },
    { uid: 8, comment: '银塔', content: '相同正文', key: ['银塔', '法师'] }
  ];
  const dup = findDuplicates(duplicateInput);
  assert.equal(dup.summary, '发现 1 组疑似重复');
  assert.match(dup.detail, /#7.*#8/);

  const info = bookInfo(entries, { name: '测试世界', bookId: 12 });
  assert.match(info.summary, /测试世界/);
  assert.match(info.detail, /ID: 12/);
  assert.match(info.detail, /law: 1/);
});
