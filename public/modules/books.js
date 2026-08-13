// ===== Archives 屏（世界书刊号：当前刊 + 全部刊 + 新建/切换/删除） =====
import { $, escHtml, showToast, showConfirm, openModal, closeModal } from './utils.js';
import { currentBookId } from './state.js';
import { apiRequest, loadBookList, loadBook, createBook, deleteBook } from './api.js';

let deps = null;     // { renderSidebar, selectEntry, renderEditorEmpty }
let setScreenFn = null;

// 搜索 + 分页
const BOOK_PAGE_SIZE = 10;
let bookSearch = '';
let archivePage = 1;
let _bookSearchTimer = null;   // 250ms 防抖
let _renderSeq = 0;            // 请求序号守卫：只渲染最新一次请求的结果

function pad2(n) { return String(n).padStart(2, '0'); }

// deps: { renderSidebar, selectEntry, renderEditorEmpty }, setScreen
export function initBooks(d, setScreen) {
  deps = d;
  setScreenFn = setScreen;

  const addBtn = $('newBookBtn');
  if (addBtn) addBtn.addEventListener('click', openBookModal);

  const createBtn = $('createBookBtn');
  if (createBtn) createBtn.addEventListener('click', onCreateBook);

  const input = $('newBookInput');
  if (input) input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); onCreateBook(); }
  });

  // 搜索按钮：展开 / 收起搜索框
  const searchBtn = $('archiveSearchBtn');
  const wrap = $('archiveSearchWrap');
  const searchInput = $('archiveSearchInput');
  if (searchBtn && wrap) {
    searchBtn.addEventListener('click', () => {
      const show = wrap.hidden;
      wrap.hidden = !show;
      searchBtn.classList.toggle('on', show);
      if (show) { if (searchInput) searchInput.focus(); }
      else { clearTimeout(_bookSearchTimer); bookSearch = ''; if (searchInput) searchInput.value = ''; archivePage = 1; renderArchives(); }
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(_bookSearchTimer);
      _bookSearchTimer = setTimeout(() => {
        bookSearch = searchInput.value.trim().toLowerCase();
        archivePage = 1;
        renderArchives();
      }, 250);
    });
  }
  const clearBtn = $('archiveSearchClear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    clearTimeout(_bookSearchTimer);
    bookSearch = '';
    if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    archivePage = 1;
    renderArchives();
  });

  // 分页
  const prev = $('bookPrev');
  if (prev) prev.addEventListener('click', () => { if (archivePage > 1) { archivePage--; renderArchives(); } });
  const next = $('bookNext');
  if (next) next.addEventListener('click', () => { archivePage++; renderArchives(); });
}

// ===== 渲染 Archives =====
export async function renderArchives() {
  const seq = ++_renderSeq;
  const grid = $('issueGrid');
  const cur = $('issueCurrent');
  const count = $('archiveCount');
  if (grid) grid.innerHTML = '<div class="empty-list" style="grid-column:1/-1">加载中…</div>';

  // 直接用 apiRequest（loadBookList 会吞掉错误静默返回 []，这里需要区分失败与空列表）
  let books;
  try {
    books = await apiRequest('GET', '/api/books');
  } catch (e) {
    if (seq !== _renderSeq) return; // 已有更新的请求
    if (grid) grid.innerHTML = '<div class="empty-list" style="grid-column:1/-1">加载失败，请检查网络后重试。</div>';
    showToast('世界书列表加载失败', 'error');
    return;
  }
  if (seq !== _renderSeq) return; // 丢弃过期响应，避免乱序覆盖新结果

  if (count) count.textContent = books.length + (books.length === 1 ? ' Issue' : ' Issues');

  // 当前刊大封面
  const current = books.find(b => b.id === currentBookId) || books[0];
  if (cur) {
    if (current) {
      cur.innerHTML =
        '<div class="issue-cover">' +
          '<div class="mini">Current issue · No.' + pad2(current.id) + '</div>' +
          '<h3>' + escHtml(current.name) + '</h3>' +
          '<p>' + current.entry_count + ' 个条目正在这一刊中编辑。</p>' +
          '<div class="big-no">' + pad2(current.id) + '</div>' +
        '</div>';
    } else {
      cur.innerHTML = '';
    }
  }

  if (!grid) return;
  const pager = $('issuePager');
  if (!books.length) {
    grid.innerHTML = '<div class="empty-list" style="grid-column:1/-1">暂无世界书，点右上角「＋」新建。</div>';
    if (pager) pager.hidden = true;
    return;
  }

  // 搜索过滤
  const filtered = bookSearch
    ? books.filter(b => (b.name || '').toLowerCase().includes(bookSearch))
    : books;
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-list" style="grid-column:1/-1">没有匹配「' + escHtml(bookSearch) + '」的世界书。</div>';
    if (pager) pager.hidden = true;
    return;
  }

  // 分页（每页 10 条）
  const totalPages = Math.max(1, Math.ceil(filtered.length / BOOK_PAGE_SIZE));
  if (archivePage > totalPages) archivePage = totalPages;
  if (archivePage < 1) archivePage = 1;
  const pageBooks = filtered.slice((archivePage - 1) * BOOK_PAGE_SIZE, archivePage * BOOK_PAGE_SIZE);

  grid.innerHTML = pageBooks.map(b => {
    const active = b.id === currentBookId ? ' active' : '';
    return '<div class="issue' + active + '" data-id="' + b.id + '" role="button" tabindex="0">' +
      '<button class="issue-del" data-del="' + b.id + '" title="删除" aria-label="删除世界书「' + escHtml(b.name) + '」">✕</button>' +
      '<div class="mini">No.' + pad2(b.id) + (b.id === currentBookId ? ' · 当前' : '') + '</div>' +
      '<h4>' + escHtml(b.name) + '</h4>' +
      '<small>' + b.entry_count + ' entries</small>' +
    '</div>';
  }).join('');

  // 分页器状态
  if (pager) {
    if (totalPages > 1) {
      pager.hidden = false;
      const info = $('bookPageInfo'); if (info) info.textContent = archivePage + ' / ' + totalPages;
      const prev = $('bookPrev'); if (prev) prev.disabled = archivePage <= 1;
      const next = $('bookNext'); if (next) next.disabled = archivePage >= totalPages;
    } else {
      pager.hidden = true;
    }
  }

  // 点击切换（键盘 Enter/Space 等价触发；删除按钮上的按键不冒泡到卡片）
  grid.querySelectorAll('.issue').forEach(card => {
    card.addEventListener('keydown', (e) => {
      if (e.target.closest('.issue-del')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.issue-del')) return;
      const id = parseInt(card.dataset.id);
      if (id === currentBookId) { if (setScreenFn) setScreenFn('library'); return; }
      await loadBook(id, deps.renderSidebar, deps.selectEntry, deps.renderEditorEmpty);
      if (setScreenFn) setScreenFn('library');
    });
  });

  // 删除：应用内确认弹窗（替代原来的 22px 二次点击，降低误删风险）
  grid.querySelectorAll('.issue-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.del);
      const book = books.find(b => b.id === id);
      const name = book ? book.name : ('#' + id);
      const ok = await showConfirm({
        title: '删除世界书',
        message: '确定删除「' + name + '」？该操作不可撤销。',
        okText: '删除',
        danger: true
      });
      if (ok) await onDeleteBook(id, books);
    });
  });
}

// ===== 新建世界书弹窗 =====
function openBookModal() {
  const modal = $('bookModal');
  const input = $('newBookInput');
  if (input) input.value = '新世界书';
  openModal(modal, { focus: input });
  if (input) { input.focus(); input.select(); }
}
function closeBookModal() {
  closeModal($('bookModal'));
}

async function onCreateBook() {
  const input = $('newBookInput');
  const name = (input && input.value.trim()) || '新世界书';
  try {
    const res = await createBook(name);
    await loadBook(res.id, deps.renderSidebar, deps.selectEntry, deps.renderEditorEmpty);
    closeBookModal();
    showToast('已创建「' + name + '」', 'success');
    renderArchives();
  } catch (e) {
    showToast('创建失败: ' + e.message, 'error');
  }
}

async function onDeleteBook(id, books) {
  const book = books.find(b => b.id === id);
  const label = book ? book.name : ('#' + id);
  try {
    await deleteBook(id);
    showToast('已删除「' + label + '」', 'success');
    if (id === currentBookId) {
      const remaining = await loadBookList();
      if (remaining.length > 0) {
        await loadBook(remaining[0].id, deps.renderSidebar, deps.selectEntry, deps.renderEditorEmpty);
      } else {
        const res = await createBook('新世界书');
        await loadBook(res.id, deps.renderSidebar, deps.selectEntry, deps.renderEditorEmpty);
      }
    }
    renderArchives();
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}
