// ===== API 请求 =====
import { showToast, validateWorldBook } from './utils.js';
import {
  worldBook, entries, currentBookId, dirty, saveTimer,
  setCurrentBookId, setDirty, setSaveTimer, applyWorldBook
} from './state.js';
import { rememberLastBookId } from './book-session.js';
import { authHeaders } from './auth.js';

// ===== API 请求基础 =====
export async function apiRequest(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...authHeaders() } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (resp.status === 401) {
    // 会话失效 → 广播回登录
    localStorage.removeItem('wbe-token');
    window.dispatchEvent(new CustomEvent('wbe:unauthorized'));
    throw new Error('登录已失效，请重新登录');
  }
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

// ===== 加载世界书列表 =====
export async function loadBookList() {
  try {
    const books = await apiRequest('GET', '/api/books');
    return books;
  } catch (e) {
    console.error('[WBE] loadBookList error:', e);
    return [];
  }
}

// ===== 新建空白世界书 =====
export async function createBook(name) {
  return apiRequest('POST', '/api/books', { name: name || '新世界书', data: { entries: {} } });
}

// ===== 删除世界书 =====
export async function deleteBook(bookId) {
  return apiRequest('DELETE', '/api/books/' + bookId);
}

// ===== 重命名世界书（PUT 带 name，需要附带 data） =====
export async function renameBook(bookId, name, data) {
  return apiRequest('PUT', '/api/books/' + bookId, { data, name });
}

// ===== 从 API 加载世界书 =====
export async function loadBook(bookId, renderSidebar, selectEntry, renderEditorEmpty) {
  console.log('[WBE] Loading book:', bookId);
  try {
    const result = await apiRequest('GET', '/api/books/' + bookId);
    const err = validateWorldBook(result.data);
    if (err) { showToast('格式错误: ' + err, 'error'); return; }
    setCurrentBookId(result.id);
    rememberLastBookId(result.id);
    applyWorldBook(result.data, result.name);
    console.log('[WBE] Loaded:', result.name, result.entry_count, 'entries');

    renderSidebar();
    if (entries.length > 0) selectEntry(entries[0].uid);
    else renderEditorEmpty();
    showToast('已加载 ' + entries.length + ' 个条目', 'success');
    updateSaveIndicator('saved');
  } catch (e) {
    console.error('[WBE] loadBook error:', e);
    showToast('加载失败: ' + e.message, 'error');
  }
}

// ===== 从文件加载（兼容旧的 sample.json） =====
export async function loadFile(url, renderSidebar, selectEntry, renderEditorEmpty) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const err = validateWorldBook(data);
    if (err) { showToast('格式错误: ' + err, 'error'); return; }
    // 保存到数据库
    const result = await apiRequest('POST', '/api/books', { name: url.split('/').pop(), data });
    setCurrentBookId(result.id);
    applyWorldBook(data, url.split('/').pop());

    renderSidebar();
    if (entries.length > 0) selectEntry(entries[0].uid);
    else renderEditorEmpty();
    showToast('已加载 ' + entries.length + ' 个条目', 'success');
    updateSaveIndicator('saved');
  } catch (e) {
    showToast('加载失败: ' + e.message, 'error');
  }
}

// ===== 导入文件 =====
export async function importFile(file, renderSidebar, selectEntry, renderEditorEmpty) {
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      const err = validateWorldBook(data);
      if (err) { showToast('格式错误: ' + err, 'error'); return; }
      const result = await apiRequest('POST', '/api/books', { name: file.name, data });
      setCurrentBookId(result.id);
      applyWorldBook(data, file.name);

      renderSidebar();
      if (entries.length > 0) selectEntry(entries[0].uid);
      else renderEditorEmpty();
      showToast('已导入 ' + entries.length + ' 个条目', 'success');
      updateSaveIndicator('saved');
    } catch (e) {
      showToast('导入失败: ' + e.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ===== 导出文件 =====
export function exportFile() {
  if (!worldBook) { showToast('没有加载数据', 'error'); return; }
  const blob = new Blob([JSON.stringify(worldBook, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const $fileName = document.getElementById('file-name');
  a.download = $fileName ? $fileName.textContent : 'world-book.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出', 'success');
}

// ===== 自动保存 =====
export function scheduleSave() {
  setDirty(true);
  updateSaveIndicator('dirty');
  if (saveTimer) clearTimeout(saveTimer);
  // 自动保存关闭时只标记为「未保存」，等用户手动点保存
  if (localStorage.getItem('wbe-autosave') === 'off') return;
  setSaveTimer(setTimeout(autoSave, 3000));
}

export async function autoSave() {
  if (!dirty || !worldBook || !currentBookId) return;
  try {
    updateSaveIndicator('saving');
    await apiRequest('PUT', '/api/books/' + currentBookId, { data: worldBook });
    setDirty(false);
    updateSaveIndicator('saved');
  } catch (e) {
    console.error('[WBE] autoSave error:', e);
    updateSaveIndicator('error');
  }
}

export function updateSaveIndicator(status) {
  const text = {
    saved: '已保存', saving: '保存中…', error: '保存失败', dirty: '未保存'
  }[status] || '已保存';
  ['saveStateEditor', 'saveStateLib'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
}
