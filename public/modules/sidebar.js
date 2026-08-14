// ===== Library 屏（杂志风：主稿 + 卡片 + 索引列表） =====
import { escHtml, $, showToast, showConfirm } from './utils.js';
import {
  entries, currentUid, currentFilter, searchQuery,
  worldBook, setEntries, setCurrentUid, setCurrentFilter, setSearchQuery,
  snapshotForUndo, uidKey
} from './state.js';
import { scheduleSave } from './api.js';

// 模块级回调 / 导航
let onSelectEntryCallback = null;
let setScreenFn = null;

// 索引列表分页
const PAGE_SIZE = 10;
let indexLimit = PAGE_SIZE;

// 语义类型筛选（叠加在 filter 之上）
let typeFilter = '';

// 批量选择模式
let selectMode = false;
const selectedSet = new Set();

function pad2(n) { return String(n).padStart(2, '0'); }

function getFiltered() {
  let list = entries.filter(e => {
    if (currentFilter === 'constant') return e.constant && !e.disable;
    if (currentFilter === 'keyword') return !e.constant && !e.disable;
    if (currentFilter === 'disabled') return e.disable;
    return true;
  });
  if (typeFilter) {
    list = list.filter(e => e.extensions && e.extensions.wbe && e.extensions.wbe.semanticType === typeFilter);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(e =>
      (e.comment || '').toLowerCase().includes(q) ||
      (e.key || []).some(k => k.toLowerCase().includes(q)) ||
      (e.keysecondary || []).some(k => k.toLowerCase().includes(q)) ||
      (e.content || '').toLowerCase().includes(q)
    );
  }
  list.sort((a, b) => a.uid - b.uid);
  return list;
}

// 搜索高亮：escHtml 后按相同子串包 <mark>（escHtml 逐字符映射，转义串与原文子串位置一致）
function hl(text, q) {
  const safe = escHtml(text == null ? '' : String(text));
  if (!q) return safe;
  const qs = escHtml(q);
  const idx = safe.toLowerCase().indexOf(qs.toLowerCase());
  if (idx < 0) return safe;
  return safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + qs.length) + '</mark>' + safe.slice(idx + qs.length);
}

// 语义类型中文标签（与 index.html 类型筛选下拉一致）
const TYPE_LABELS = {
  character: '人物', location: '地点', geography: '地理', organization: '组织', faction: '阵营',
  law: '法律', history: '历史', economy: '经济', magic: '魔法', culture: '文化',
  event: '事件', rule: '规则', item: '物品', concept: '概念', relationship: '关系', style: '文风'
};
function typeLabelOf(e) {
  const t = e && e.extensions && e.extensions.wbe && e.extensions.wbe.semanticType;
  return t ? (TYPE_LABELS[t] || t) : '';
}

function statusOf(e) {
  if (e.disable) return { cls: 'off', label: 'Disabled' };
  if (e.constant) return { cls: 'const', label: 'Always on' };
  return { cls: '', label: 'Keyword' };
}

function typeOf(e) {
  if (e.disable) return '禁用';
  if (e.constant) return '常驻';
  return '关键词';
}

function preview(e) {
  const c = (e.content || '').replace(/\s+/g, ' ').trim();
  return c || '（暂无内容）';
}

// ===== 渲染 Library =====
export function renderSidebar() {
  const filtered = getFiltered();

  const elCount = $('entryCount');
  if (elCount) elCount.textContent = pad2(entries.length) + ' Entries';
  const elVisible = $('visibleCount');
  if (elVisible) elVisible.textContent = pad2(filtered.length) + ' pieces';

  renderFeature(filtered[0], {
    noEntries: entries.length === 0,
    query: searchQuery,
    filter: currentFilter
  });
  renderGrid(filtered.slice(1, 5));
  renderIndex(filtered.slice(5));
  renderStats();
  updateBatchCount();
  // 首次渲染标记 stagger（进入屏时卡片错落入场；筛选/搜索重建不再重复动画）
  markStagger($('featureEntry'));
  markStagger($('entryGrid'));
  markStagger($('indexList'));
}

function markStagger(el) {
  if (el && !el.dataset.staggered) { el.classList.add('stagger'); el.dataset.staggered = '1'; }
}

// ===== 全书统计 =====
function renderStats() {
  const constN = entries.filter(e => e.constant && !e.disable).length;
  const kwN = entries.filter(e => !e.constant && !e.disable).length;
  const disN = entries.filter(e => e.disable).length;
  const chars = entries.reduce((s, e) => s + ((e.content || '').length || 0), 0);
  const set = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
  set('statConst', constN);
  set('statKw', kwN);
  set('statDisabled', disN);
  set('statChars', chars.toLocaleString());
}

// 空状态文案：区分「零条目」与「搜索/筛选无匹配」
function emptyFeatureText(info) {
  if (info.noEntries) return '还没有条目。点右下角「＋」开始建立这一册世界书。';
  if (info.query) return '没有匹配「' + escHtml(info.query) + '」的条目。';
  return '当前筛选下没有条目。';
}

function renderFeature(e, emptyInfo) {
  const el = $('featureEntry');
  if (!el) return;
  if (!e) {
    el.className = 'feature empty';
    el.disabled = true;
    el.innerHTML = emptyFeatureText(emptyInfo || {});
    el.onclick = null;
    return;
  }
  const st = statusOf(e);
  const kw = (e.key || []).slice(0, 4).join(' · ') || '常驻注入';
  const selCls = selectMode && selectedSet.has(e.uid) ? ' selected' : '';
  el.className = 'feature' + selCls;
  el.disabled = false;
  el.innerHTML =
    '<div class="feature-meta">' +
      '<span class="number">' + pad2(e.uid) + '</span>' +
      '<span>' + escHtml(typeOf(e)) + '</span>' +
      '<span>·</span><span>Lead entry</span>' +
    '</div>' +
    '<h2 class="feature-title">' + hl(e.comment || '(无标题)', searchQuery) + '</h2>' +
    '<p class="feature-summary">' + hl(preview(e).slice(0, 140), searchQuery) + '</p>' +
    '<div class="feature-footer">' +
      '<span class="tagline">' + escHtml(kw) + '</span>' +
      '<span class="entry-status ' + st.cls + '"><span class="dot"></span>' + st.label + '</span>' +
    '</div>';
  el.onclick = () => open(e.uid);
}

function renderGrid(list) {
  const el = $('entryGrid');
  if (!el) return;
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = list.map(e => {
    const st = statusOf(e);
    const typeLabel = typeLabelOf(e);
    const selCls = selectMode && selectedSet.has(e.uid) ? ' selected' : '';
    return '<button type="button" class="entry-card' + selCls + '" data-uid="' + e.uid + '" aria-label="打开条目 ' + escHtml(e.comment || '(无标题)') + '">' +
      '<div class="entry-no">' + pad2(e.uid) + '</div>' +
      '<div class="type">' + escHtml(typeOf(e)) + (typeLabel ? '<span class="type-badge">' + escHtml(typeLabel) + '</span>' : '') + '</div>' +
      '<h3>' + hl(e.comment || '(无标题)', searchQuery) + '</h3>' +
      '<p>' + hl(preview(e).slice(0, 90), searchQuery) + '</p>' +
      '<div class="entry-status ' + st.cls + '"><span class="dot"></span>' + st.label + '</div>' +
    '</button>';
  }).join('');
  el.querySelectorAll('.entry-card').forEach(card =>
    card.addEventListener('click', () => open(parseInt(card.dataset.uid)))
  );
}

function renderIndex(list) {
  const el = $('indexList');
  const more = $('loadMoreBtn');
  if (!el) return;

  if (!list.length) {
    el.innerHTML = '';
    if (more) more.hidden = true;
    return;
  }

  const shown = list.slice(0, indexLimit);
  el.innerHTML = shown.map(e => {
    const st = statusOf(e);
    const kw = (e.key || []).slice(0, 3).join(' · ') || (e.constant ? '常驻' : '—');
    const typeLabel = typeLabelOf(e);
    const selCls = selectMode && selectedSet.has(e.uid) ? ' selected' : '';
    return '<button type="button" class="index-row' + selCls + '" data-uid="' + e.uid + '" aria-label="打开条目 ' + escHtml(e.comment || '(无标题)') + '">' +
      '<div class="index-no">' + pad2(e.uid) + '</div>' +
      '<div class="index-copy">' +
        '<strong>' + hl(e.comment || '(无标题)', searchQuery) + (typeLabel ? ' <span class="type-badge type-badge-sm">' + escHtml(typeLabel) + '</span>' : '') + '</strong>' +
        '<small>' + escHtml(kw) + '</small>' +
      '</div>' +
      '<div class="index-state ' + st.cls + '"><span class="dot"></span>' + st.label + '</div>' +
    '</button>';
  }).join('');
  el.querySelectorAll('.index-row').forEach(row =>
    row.addEventListener('click', () => open(parseInt(row.dataset.uid)))
  );

  if (more) {
    if (list.length > indexLimit) {
      more.hidden = false;
      more.textContent = 'Load more · 还有 ' + (list.length - indexLimit) + ' 条';
    } else {
      more.hidden = true;
    }
  }
}

// 点击条目：多选模式下切换选中，否则选中 + 跳到 Editor
function open(uid) {
  if (selectMode) { toggleSelect(uid); return; }
  selectEntry(uid);
  if (setScreenFn) setScreenFn('editor');
}

// ===== 批量选择模式 =====
function updateBatchCount() {
  const c = $('batchCount');
  if (c) c.textContent = '已选 ' + selectedSet.size + ' 条';
}

function setSelectMode(on) {
  selectMode = on;
  const bar = $('batchBar');
  if (bar) bar.classList.toggle('on', on);
  const btn = $('selectModeBtn');
  if (btn) btn.classList.toggle('on', on);
  if (!on) selectedSet.clear();
  renderSidebar();
}

function toggleSelect(uid) {
  if (selectedSet.has(uid)) selectedSet.delete(uid); else selectedSet.add(uid);
  document.querySelectorAll('[data-uid="' + uid + '"]').forEach(el2 => el2.classList.toggle('selected', selectedSet.has(uid)));
  updateBatchCount();
}

function selectedEntries() {
  return entries.filter(e => selectedSet.has(e.uid));
}

// 批量字段操作（置常驻/启用/禁用）
function batchSetField(field, value, label) {
  const list = selectedEntries();
  if (!list.length) { showToast('未选中任何条目', 'info'); return; }
  snapshotForUndo(label);
  list.forEach(e => { e[field] = value; });
  renderSidebar();
  scheduleSave();
  showToast(label + ' ' + list.length + ' 条', 'success');
}

// 批量删除（含确认）
async function batchDelete() {
  const list = selectedEntries();
  if (!list.length) { showToast('未选中任何条目', 'info'); return; }
  const ok = await showConfirm({
    title: '批量删除',
    message: '确定删除选中的 ' + list.length + ' 个条目？可用 Ctrl/Cmd+Z 撤销。',
    okText: '删除',
    danger: true
  });
  if (!ok) return;
  snapshotForUndo('批量删除');
  list.forEach(e => { delete worldBook.entries[uidKey(e.uid)]; });
  setEntries(entries.filter(e => !selectedSet.has(e.uid)));
  selectedSet.clear();
  renderSidebar();
  // 正编辑的条目若被删，清空编辑器
  if (currentUid != null && !entries.some(e => e.uid === currentUid)) {
    setCurrentUid(null);
    if (deps && deps.renderEditorEmpty) deps.renderEditorEmpty();
  }
  scheduleSave();
  showToast('已删除 ' + list.length + ' 条', 'success');
}

function initBatchBar() {
  const modeBtn = $('selectModeBtn');
  if (modeBtn) modeBtn.addEventListener('click', () => setSelectMode(!selectMode));
  const allBtn = $('batchAllBtn');
  if (allBtn) allBtn.addEventListener('click', () => {
    getFiltered().forEach(e => selectedSet.add(e.uid));
    renderSidebar();
  });
  const constBtn = $('batchConstBtn');
  if (constBtn) constBtn.addEventListener('click', () => batchSetField('constant', true, '已置常驻'));
  const enableBtn = $('batchEnableBtn');
  if (enableBtn) enableBtn.addEventListener('click', () => batchSetField('disable', false, '已启用'));
  const disableBtn = $('batchDisableBtn');
  if (disableBtn) disableBtn.addEventListener('click', () => batchSetField('disable', true, '已禁用'));
  const delBtn = $('batchDeleteBtn');
  if (delBtn) delBtn.addEventListener('click', batchDelete);
  const doneBtn = $('batchDoneBtn');
  if (doneBtn) doneBtn.addEventListener('click', () => setSelectMode(false));
}

// ===== 选中条目（供 chat.js / api.loadBook 调用，不强制切屏） =====
export function selectEntry(uid) {
  setCurrentUid(uid);
  const entry = entries.find(e => e.uid === uid);
  if (!entry) return;
  if (onSelectEntryCallback) onSelectEntryCallback(uid);
}

// ===== 筛选 =====
function initFilters() {
  const box = $('categories');
  if (!box) return;
  box.querySelectorAll('.category').forEach(chip => {
    chip.addEventListener('click', () => {
      box.querySelectorAll('.category').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      setCurrentFilter(chip.dataset.filter || 'all');
      indexLimit = PAGE_SIZE;
      renderSidebar();
    });
  });
}

// ===== 搜索（200ms 防抖） =====
let _searchTimer = null;
function initSearch() {
  const input = $('searchInput');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      setSearchQuery(input.value.trim());
      indexLimit = PAGE_SIZE;
      renderSidebar();
    }, 200);
  });
}

// ===== Load more =====
function initLoadMore() {
  const btn = $('loadMoreBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    indexLimit += PAGE_SIZE;
    renderSidebar();
  });
}

// 旧接口占位（app.js 不再用 Tab，保留空实现以防外部引用）
export function switchTab() {}

// ===== 初始化 =====
export function initSidebar(selectEntryCallback, setScreen) {
  onSelectEntryCallback = selectEntryCallback;
  setScreenFn = setScreen;
  initFilters();
  initSearch();
  initLoadMore();
  initTypeFilter();
  initBatchBar();
}

// 语义类型筛选（与状态筛选叠加）
function initTypeFilter() {
  const sel = $('typeFilterSelect');
  if (!sel) return;
  sel.addEventListener('change', () => {
    typeFilter = sel.value || '';
    indexLimit = PAGE_SIZE;
    renderSidebar();
  });
}
