// ===== API 请求 =====
import { $, showToast, showConfirm, validateWorldBook, openModal, closeModal } from './utils.js';
import {
  worldBook, entries, currentBookId, dirty, saveTimer,
  setCurrentBookId, setDirty, setSaveTimer, applyWorldBook, setEntries, snapshotForUndo
} from './state.js';
import { rememberLastBookId } from './book-session.js';
import { authHeaders } from './auth.js';

// 多端冲突检测：记录加载/保存时的服务端 updated_at，保存时回传比对
let baseUpdatedAt = null;
export function getBaseUpdatedAt() { return baseUpdatedAt; }

let wbeDeps = null; // { renderSidebar, selectEntry, renderEditorEmpty } 由 app.js 注入
export function setWbeDeps(d) { wbeDeps = d; }

// 保存前检查：被别处修改则弹出冲突处理（加载最新 / 仍要覆盖 / 取消）
async function resolveConflict(id, payload, retry) {
  const loadLatest = await showConfirm({
    title: '保存冲突',
    message: '这份世界书已在其他设备或标签页被修改。要加载最新版本吗？（本地未保存的修改将被丢弃）',
    okText: '加载最新'
  });
  if (loadLatest) {
    try {
      await loadBook(id, wbeDeps.renderSidebar, wbeDeps.selectEntry, wbeDeps.renderEditorEmpty);
      setDirty(false);
      showToast('已加载最新版本', 'success');
      return;
    } catch (e) { showToast('加载失败: ' + e.message, 'error'); return; }
  }
  const overwrite = await showConfirm({
    title: '仍要覆盖?',
    message: '继续保存会用本地内容覆盖远端的最新修改,确定吗?',
    okText: '仍要覆盖',
    danger: true
  });
  if (overwrite) await retry(true);
}

// 保存世界书本体:baseUpdatedAt 冲突时返回 409,force 跳过校验
async function saveBookRaw(id, payload, force) {
  const resp = await fetch('/api/books/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(force ? { ...payload, force: true } : { ...payload, baseUpdatedAt })
  });
  if (!resp.ok) {
    if (resp.status === 409) return { conflict: true };
    throw new Error('HTTP ' + resp.status);
  }
  return resp.json();
}
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
  const res = await saveBookRaw(bookId, { data, name }, false);
  if (res.conflict) {
    await resolveConflict(bookId, { data, name }, force => saveBookRaw(bookId, { data, name }, force));
    return { ok: true };
  }
  if (res.updated_at) baseUpdatedAt = res.updated_at;
  return res;
}

// ===== 从 API 加载世界书 =====
export async function loadBook(bookId, renderSidebar, selectEntry, renderEditorEmpty) {
  console.log('[WBE] Loading book:', bookId);
  try {
    const result = await apiRequest('GET', '/api/books/' + bookId);
    const err = validateWorldBook(result.data);
    if (err) { showToast('格式错误: ' + err, 'error'); return; }
    setCurrentBookId(result.id);
    baseUpdatedAt = result.updated_at || null;
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
    baseUpdatedAt = result.updated_at || null;
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
      // 导入合并检测：与当前书比较，发现重复则让用户选择（合并跳过重复 / 全部导入 / 导入为新书）
      const incoming = Object.values(data.entries || {}).sort((a, b) => (a.uid || 0) - (b.uid || 0));
      const existing = entries.slice();
      const isDup = e => existing.some(x =>
        (x.comment && x.comment === e.comment) || (x.content && x.content === e.content && e.content.trim()));
      const dupes = incoming.filter(isDup);
      if (currentBookId && existing.length > 0 && dupes.length > 0) {
        await openImportModal(data, incoming, dupes.length, file.name, renderSidebar, selectEntry, renderEditorEmpty);
      } else {
        await importAsNewBook(data, file.name, renderSidebar, selectEntry, renderEditorEmpty);
      }
    } catch (e) {
      showToast('导入失败: ' + e.message, 'error');
    }
  };
  reader.readAsText(file);
}

function importAsNewBook(data, name, renderSidebar, selectEntry, renderEditorEmpty) {
  return apiRequest('POST', '/api/books', { name, data }).then(result => {
    setCurrentBookId(result.id);
    baseUpdatedAt = result.updated_at || null;
    applyWorldBook(data, name);
    renderSidebar();
    if (entries.length > 0) selectEntry(entries[0].uid);
    else renderEditorEmpty();
    showToast('已导入 ' + entries.length + ' 个条目', 'success');
    updateSaveIndicator('saved');
  });
}

// 合并到当前书：新 uid 递增分配；skipDupes 时跳过重复条目
function mergeImport(data, skipDupes) {
  const incoming = Object.values(data.entries || {}).sort((a, b) => (a.uid || 0) - (b.uid || 0));
  const existing = entries.slice();
  let uid = nextUidLocal();
  let added = 0, skipped = 0;
  snapshotForUndo('导入合并');
  for (const e of incoming) {
    const dup = skipDupes && existing.some(x =>
      (x.comment && x.comment === e.comment) || (x.content && x.content === e.content && e.content.trim()));
    if (dup) { skipped++; continue; }
    const copy = JSON.parse(JSON.stringify(e));
    copy.uid = uid++;
    worldBook.entries[copy.uid] = copy;
    existing.push(copy);
    added++;
  }
  setEntries(existing);
  return { added, skipped };
}
function nextUidLocal() {
  if (!worldBook || !worldBook.entries) return 0;
  const uids = Object.values(worldBook.entries).map(e => e.uid || 0);
  return uids.length > 0 ? Math.max(...uids) + 1 : 0;
}

// 导入选择弹窗（仅出现一次绑定；mode: merge / all / new）
let importModalBound = false;
function openImportModal(data, incoming, dupCount, name, renderSidebar, selectEntry, renderEditorEmpty) {
  const modal = document.getElementById('importModal');
  if (!modal) return importAsNewBook(data, name, renderSidebar, selectEntry, renderEditorEmpty);
  const msg = document.getElementById('importModalMsg');
  const mergeBtn = document.getElementById('importMergeBtn');
  const allBtn = document.getElementById('importAllBtn');
  const newBtn = document.getElementById('importNewBookBtn');
  if (msg) msg.textContent = '「' + name + '」包含 ' + incoming.length + ' 个条目，其中 ' + dupCount + ' 个与当前世界书重复。';
  if (mergeBtn) mergeBtn.textContent = '合并（跳过 ' + dupCount + ' 条重复）';
  if (!importModalBound && modal) {
    importModalBound = true;
    const pick = async mode => {
      closeModal(modal);
      try {
        if (mode === 'new') {
          await importAsNewBook(data, name, renderSidebar, selectEntry, renderEditorEmpty);
        } else {
          const r = mergeImport(data, mode === 'merge');
          renderSidebar();
          scheduleSave();
          showToast('已合并 ' + r.added + ' 条' + (r.skipped ? '，跳过 ' + r.skipped + ' 条重复' : ''), 'success');
        }
      } catch (e) { showToast('导入失败: ' + e.message, 'error'); }
    };
    if (mergeBtn) mergeBtn.addEventListener('click', () => pick('merge'));
    if (allBtn) allBtn.addEventListener('click', () => pick('all'));
    if (newBtn) newBtn.addEventListener('click', () => pick('new'));
  }
  openModal(modal);
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

// ===== 导出为 Markdown（按条目生成，适合阅读/分享） =====
export function exportMarkdown() {
  if (!worldBook || !entries) { showToast('没有加载数据', 'error'); return; }
  const $fileName = document.getElementById('file-name');
  const bookName = $fileName ? $fileName.textContent : 'world-book';
  const lines = ['# ' + bookName, '', '> 由 World Book Editor 导出 · 共 ' + entries.length + ' 个条目', ''];
  const sorted = entries.slice().sort((a, b) => a.uid - b.uid);
  for (const e of sorted) {
    const wbe = (e.extensions && e.extensions.wbe) || {};
    const typeLabel = wbe.semanticType ? ' · ' + wbe.semanticType : '';
    const stateLabel = e.disable ? '· 禁用' : (e.constant ? '· 常驻' : '· 关键词');
    lines.push('## ' + (e.comment || 'UID ' + e.uid) + ' `#' + e.uid + '` ' + typeLabel + ' ' + stateLabel, '');
    if (e.key && e.key.length) lines.push('**触发词：** ' + e.key.join('、'), '');
    if (e.keysecondary && e.keysecondary.length) lines.push('**次要触发词：** ' + e.keysecondary.join('、'), '');
    if (e.content) lines.push(e.content, '');
    lines.push('---', '');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (String(bookName).replace(/[\\/:*?"<>|]+/g, '_') || 'world-book') + '.md';
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出 Markdown（' + entries.length + ' 条）', 'success');
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
    const res = await saveBookRaw(currentBookId, { data: worldBook }, false);
    if (res.conflict) {
      updateSaveIndicator('dirty');
      await resolveConflict(currentBookId, { data: worldBook }, async force => {
        const r2 = await saveBookRaw(currentBookId, { data: worldBook }, force);
        if (r2.conflict) throw new Error('conflict');
        if (r2.updated_at) baseUpdatedAt = r2.updated_at;
        setDirty(false);
        updateSaveIndicator('saved');
      });
      return;
    }
    if (res.updated_at) baseUpdatedAt = res.updated_at;
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
