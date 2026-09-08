import assert from 'node:assert/strict';
import test from 'node:test';

import { CommandType } from '../public/modules/domain/worldbook-commands.js';
import {
  SMART_DRAFT_TOOL_NAMES,
  buildSmartDraftCompletionMessages,
  completeSmartDraftContent,
  createSmartDraftOrchestrator,
  newEntryHealthDetail,
  relatedEntriesAdvice,
  smartDraftContentNeedsCompletion,
  smartDraftDetail
} from '../public/modules/ai/tools/smart-draft.js';

function draft(overrides = {}) {
  return {
    semanticType: 'character',
    functionType: 'keyword_lore',
    decision: null,
    customType: '',
    classificationReason: '',
    templateSections: ['身份', '外貌', '关系'],
    title: '林霁',
    content: '身份：王城医生\n外貌：黑发灰眼，穿深色长外套。\n关系：与药师协会长期合作。',
    fields: { constant: false, position: 0, depth: 4, order: 100, key: ['林霁'] },
    checks: [],
    ...overrides
  };
}

test('smart draft registry remains explicit', () => {
  assert.deepEqual(SMART_DRAFT_TOOL_NAMES, ['plan_smart_entry', 'create_smart_entry']);
});

test('completion policy detects short/placeholding/missing-section content', () => {
  assert.equal(smartDraftContentNeedsCompletion(draft()).incomplete, false);
  assert.equal(smartDraftContentNeedsCompletion(draft({ content: '需要补充外貌' })).incomplete, true);
  assert.equal(smartDraftContentNeedsCompletion(draft({ content: '身份：医生。外貌：黑发。' })).incomplete, true);
});

test('completion messages preserve topic, template and current content', () => {
  const d = draft({ content: '身份：医生' });
  const messages = buildSmartDraftCompletionMessages(d);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /四要素/);
  assert.match(messages[1].content, /条目主题：林霁/);
  assert.match(messages[1].content, /身份、外貌、关系/);
  assert.match(messages[1].content, /身份：医生/);
});

test('completion skips complete drafts and preserves draft on completion failure', async () => {
  const complete = draft();
  let calls = 0;
  assert.equal(await completeSmartDraftContent(complete, { completeAuxiliary: async () => { calls++; } }), complete);
  assert.equal(calls, 0);

  const incomplete = draft({ content: '太短' });
  const errors = [];
  const result = await completeSmartDraftContent(incomplete, {
    completeAuxiliary: async () => { throw new Error('offline'); },
    onError: error => errors.push(error.message)
  });
  assert.equal(result.content, '太短');
  assert.deepEqual(errors, ['offline']);
});

test('completion only replaces content when returned text is sufficiently substantial', async () => {
  const d = draft({ content: '很短' });
  await completeSmartDraftContent(d, { completeAuxiliary: async () => '身份：完整正文，包含足够多的具体信息。\n外貌：黑发灰眼。\n关系：与协会合作。' });
  assert.match(d.content, /完整正文/);

  const keep = draft({ content: '需要补充这里，这一段本身已经有不少字数作为比较基线。' });
  await completeSmartDraftContent(keep, { completeAuxiliary: async () => '太短' });
  assert.match(keep.content, /比较基线/);
});

test('related entry advice reports missing entities but suppresses existing ones', () => {
  const args = { relatedEntries: [
    { name: '王城医院', type: '地点' },
    { name: '药师协会', type: '组织', note: '负责药材' }
  ] };
  const text = relatedEntriesAdvice(args, [{ comment: '王城医院' }]);
  assert.doesNotMatch(text, /· 王城医院/);
  assert.match(text, /· 药师协会（组织） — 负责药材/);

  assert.match(relatedEntriesAdvice(args, [{ comment: '王城医院' }, { comment: '药师协会' }]), /均已有条目/);
});

test('smart draft detail and health detail preserve legacy review information', () => {
  const d = draft({ checks: [{ level: 'warning', message: '关键词可能过泛' }] });
  const detail = smartDraftDetail(d, 8);
  assert.match(detail, /UID: 8/);
  assert.match(detail, /标题: 林霁/);
  assert.match(detail, /关键词: 林霁/);
  assert.match(detail, /warning.*关键词可能过泛/);

  const health = newEntryHealthDetail(8, d, [{ uid: 8, comment: '林霁', key: ['林霁'], content: d.content, disable: false }]);
  assert.match(health, /新条目体检/);
  assert.match(health, /关键词可能过泛/);
});

function makeOrchestratorHarness() {
  const entries = [];
  const calls = [];
  const previews = [];
  const active = [];
  let uid = 1;

  const orchestrator = createSmartDraftOrchestrator({
    getEntries: () => entries,
    getWritingTemplate: () => ({}),
    completeAuxiliary: async () => '身份：王城医生，负责夜间急诊。\n外貌：黑发灰眼，穿深绿羊毛长外套、黑色长裤与皮靴。\n关系：与药师协会和王城医院保持长期合作。\n地点：常驻王城医院东塔诊室，也会前往旧港义诊。\n数字：每周值夜三次，普通诊金 12 银币。\n规则：急诊先分级再收费，危重者优先。',
    nextUid: () => uid++,
    createEntry: id => ({ uid: id, comment: '', content: '', key: [], extensions: {} }),
    runCommand: (command, options) => {
      calls.push({ command, options });
      if (command.type !== CommandType.CREATE_ENTRY) return { changed: false };
      entries.push(command.entry);
      return { changed: true, createdUids: [command.entry.uid] };
    },
    renderSidebar: () => calls.push({ ui: 'sidebar' }),
    scheduleSave: () => calls.push({ ui: 'save' }),
    setActiveDraft: record => active.push(record),
    showDraftPreview: record => previews.push(record)
  });
  return { orchestrator, entries, calls, previews, active };
}

test('plan_smart_entry prepares a record, opens preview, and stops the tool loop', async () => {
  const h = makeOrchestratorHarness();
  const result = await h.orchestrator.handlers.plan_smart_entry({
    title: '林霁', semanticType: 'character', userRequest: '创建人物林霁', content: '太短'
  });
  assert.equal(result.stop, true);
  assert.match(result.summary, /智能条目预览/);
  assert.equal(h.active.length, 1);
  assert.equal(h.previews.length, 1);
  assert.equal(h.entries.length, 0);
  assert.match(result.detail, /草稿 ID:/);
});

test('create_smart_entry writes through CREATE_ENTRY and returns health metadata', async () => {
  const h = makeOrchestratorHarness();
  const result = await h.orchestrator.handlers.create_smart_entry({
    title: '林霁', semanticType: 'character', userRequest: '创建人物林霁', content: '太短',
    relatedEntries: [{ name: '王城医院', type: '地点' }]
  });
  assert.equal(result.uid, 1);
  assert.equal(h.entries.length, 1);
  assert.equal(h.calls[0].command.type, CommandType.CREATE_ENTRY);
  assert.match(result.summary, /已智能创建 #1/);
  assert.match(result.detail, /关联词条建议/);
  assert.match(result.detail, /新条目体检/);
});

test('commitDraft is reusable by the manual preview confirm path', () => {
  const h = makeOrchestratorHarness();
  const result = h.orchestrator.commitDraft(draft());
  assert.equal(result.uid, 1);
  assert.equal(h.entries[0].comment, '林霁');
  assert.equal(h.calls[0].command.type, CommandType.CREATE_ENTRY);
});
