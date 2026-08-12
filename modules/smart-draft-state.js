export function createSmartDraftState() {
  return {
    records: new Map(),
    activeId: null
  };
}

export function setActiveSmartDraft(state, record) {
  state.records.clear();
  if (!record || !record.id) {
    state.activeId = null;
    return null;
  }
  state.records.set(record.id, record);
  state.activeId = record.id;
  return record;
}

export function getActiveSmartDraft(state) {
  if (!state.activeId) return null;
  return state.records.get(state.activeId) || null;
}

export function takeActiveSmartDraft(state) {
  const record = getActiveSmartDraft(state);
  clearActiveSmartDraft(state);
  return record;
}

export function clearActiveSmartDraft(state) {
  state.records.clear();
  state.activeId = null;
}
