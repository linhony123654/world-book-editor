import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSmartDraftState,
  setActiveSmartDraft,
  takeActiveSmartDraft,
  clearActiveSmartDraft,
  getActiveSmartDraft
} from '../modules/smart-draft-state.js';

test('keeps only the latest smart draft preview active', () => {
  const state = createSmartDraftState();
  const first = { id: 'draft-1', draft: { title: '旧草稿' } };
  const second = { id: 'draft-2', draft: { title: '新草稿' } };

  setActiveSmartDraft(state, first);
  setActiveSmartDraft(state, second);

  assert.equal(state.records.size, 1);
  assert.equal(getActiveSmartDraft(state).id, 'draft-2');
  assert.equal(state.records.has('draft-1'), false);
});

test('taking the active smart draft removes it from pending state', () => {
  const state = createSmartDraftState();
  setActiveSmartDraft(state, { id: 'draft-1', draft: { title: '灰渠街地下诊所' } });

  const record = takeActiveSmartDraft(state);

  assert.equal(record.id, 'draft-1');
  assert.equal(getActiveSmartDraft(state), null);
  assert.equal(state.records.size, 0);
});

test('clears active smart draft when preview modal is dismissed', () => {
  const state = createSmartDraftState();
  setActiveSmartDraft(state, { id: 'draft-1', draft: { title: '灰渠街地下诊所' } });

  clearActiveSmartDraft(state);

  assert.equal(getActiveSmartDraft(state), null);
  assert.equal(state.records.size, 0);
});
