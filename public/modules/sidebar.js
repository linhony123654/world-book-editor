// ===== Library 屏（杂志风：主稿 + 卡片 + 索引列表） =====
import { escHtml, $ } from './utils.js';
import {
  entries, currentUid, currentFilter, searchQuery,
  setCurrentUid, setCurrentFilter, setSearchQuery
} from './state.js';

// 模块级回调 / 导航
let onSelectEntryCallback = null;
let setScreenFn = null;

// 索引列表分页
const PAGE_SIZE = 10;
let indexLimit = PAGE_SIZE;

function pad2(n) { return String(n).padStart(2, '0'); }

function getFiltered() {
  let list = entries.filter(e => {
    if (currentFilter === 'constant') return e.constant && !e.disable;
    if (currentFilter === 'keyword') return !e.constant && !e.disable;
    if (currentFilter === 'disabled') return e.disable;
    return true;
  });
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
  el.className = 'feature';
  el.disabled = false;
  el.innerHTML =
    '<div class="feature-meta">' +
      '<span class="number">' + pad2(e.uid) + '</span>' +
      '<span>' + escHtml(typeOf(e)) + '</span>' +
      '<span>·</span><span>Lead entry</span>' +
    '</div>' +
    '<h2 class="feature-title">' + escHtml(e.comment || '(无标题)') + '</h2>' +
    '<p class="feature-summary">' + escHtml(preview(e).slice(0, 140)) + '</p>' +
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
    return '<button type="button" class="entry-card" data-uid="' + e.uid + '" aria-label="打开条目 ' + escHtml(e.comment || '(无标题)') + '">' +
      '<div class="entry-no">' + pad2(e.uid) + '</div>' +
      '<div class="type">' + escHtml(typeOf(e)) + '</div>' +
      '<h3>' + escHtml(e.comment || '(无标题)') + '</h3>' +
      '<p>' + escHtml(preview(e).slice(0, 90)) + '</p>' +
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
    return '<button type="button" class="index-row" data-uid="' + e.uid + '" aria-label="打开条目 ' + escHtml(e.comment || '(无标题)') + '">' +
      '<div class="index-no">' + pad2(e.uid) + '</div>' +
      '<div class="index-copy">' +
        '<strong>' + escHtml(e.comment || '(无标题)') + '</strong>' +
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

// 点击条目：选中 + 跳到 Editor
function open(uid) {
  selectEntry(uid);
  if (setScreenFn) setScreenFn('editor');
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
}
