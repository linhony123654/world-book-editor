// ===== 状态管理 =====

// ===== 工具函数 =====
export function uidKey(uid) {
  return String(uid);
}

// ===== 全局状态 =====
export let worldBook = null;
export let entries = [];
export let currentUid = null;
export let currentFilter = 'all';
export let searchQuery = '';
export let originalEntries = null;
export let currentBookId = null;
export let saveTimer = null;
export let dirty = false;

// ===== 状态更新函数 =====
export function setWorldBook(data) {
  worldBook = data;
}

export function setEntries(data) {
  entries.length = 0;
  entries.push(...data);
}

export function setCurrentUid(uid) {
  currentUid = uid;
}

export function setCurrentFilter(filter) {
  currentFilter = filter;
}

export function setSearchQuery(query) {
  searchQuery = query;
}

export function setOriginalEntries(data) {
  originalEntries = data;
}

export function setCurrentBookId(id) {
  currentBookId = id;
}

export function setSaveTimer(timer) {
  saveTimer = timer;
}

export function setDirty(value) {
  dirty = value;
}

// ===== 初始化空白世界书 =====
export function createEmptyWorldBook() {
  return { entries: {} };
}

// ===== 分配新 UID =====
export function nextUid() {
  if (!worldBook || !worldBook.entries) return 0;
  const uids = Object.values(worldBook.entries).map(e => e.uid || 0);
  return uids.length > 0 ? Math.max(...uids) + 1 : 0;
}

// ===== 创建默认条目 =====
export function createEntry(uid) {
  return {
    uid,
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    selective: false,
    selectiveLogic: 0,
    order: 100,
    position: 0,
    disable: false,
    addMemo: true,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    probability: 100,
    depth: 4,
    useProbability: true,
    role: null,
    vectorized: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    displayIndex: 0,
    ignoreBudget: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    outletName: '',
    triggers: [],
    characterFilter: { isExclude: false, names: [], tags: [] }
  };
}

// ===== 应用世界书数据 =====
export function applyWorldBook(data, name) {
  worldBook = data;
  const newEntries = Object.values(worldBook.entries);
  entries.length = 0;
  entries.push(...newEntries);
  window._wbe_entries = entries;
  window._wbe_worldBook = worldBook;
  originalEntries = JSON.parse(JSON.stringify(data));
  dirty = false;

  const bookName = name || 'world-book.json';
  const $fileName = document.getElementById('file-name');
  if ($fileName) $fileName.textContent = bookName;
  const $libBookName = document.getElementById('libBookName');
  if ($libBookName) $libBookName.textContent = bookName;

  undoStack.length = 0;

  return { entries, worldBook };
}

// ===== 撤销栈 =====
export const undoStack = [];

// 在破坏性操作前调用，存一份 worldBook 深拷贝
export function snapshotForUndo(label) {
  if (!worldBook) return;
  try {
    undoStack.push({ label: label || '操作', ts: Date.now(), data: JSON.parse(JSON.stringify(worldBook)) });
    if (undoStack.length > 20) undoStack.shift();
  } catch (e) {}
}

export function undoStackLength() { return undoStack.length; }

// 撤销上一次操作；原地恢复 worldBook.entries，保持引用稳定。返回被撤销操作的标签，无可撤销返回 null
export function restoreUndo() {
  if (undoStack.length === 0 || !worldBook) return null;
  const snap = undoStack.pop();
  Object.keys(worldBook.entries).forEach(k => delete worldBook.entries[k]);
  Object.assign(worldBook.entries, JSON.parse(JSON.stringify(snap.data.entries)));
  entries.length = 0;
  entries.push(...Object.values(worldBook.entries));
  window._wbe_entries = entries;
  dirty = true;
  return snap.label;
}

// 回滚到指定栈深度（批量撤销，如 AI 一轮多步操作）。返回被撤销操作的标签数组；无可撤销返回 null
// targetLength = 0 时回滚全部（恢复到第一条快照）
export function restoreUndoTo(targetLength) {
  if (!worldBook || undoStack.length <= targetLength) return null;
  const labels = [];
  let lastSnap = null;
  while (undoStack.length > targetLength) {
    lastSnap = undoStack.pop();
    labels.unshift(lastSnap.label);
  }
  const snap = undoStack[undoStack.length - 1] || lastSnap;
  if (snap) {
    Object.keys(worldBook.entries).forEach(k => delete worldBook.entries[k]);
    Object.assign(worldBook.entries, JSON.parse(JSON.stringify(snap.data.entries)));
    entries.length = 0;
    entries.push(...Object.values(worldBook.entries));
    window._wbe_entries = entries;
    dirty = true;
  }
  return labels.length ? labels : null;
}
