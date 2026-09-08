const DIFF_FIELDS = Object.freeze([
  'comment', 'content', 'constant', 'disable', 'depth', 'order', 'position',
  'selective', 'sticky', 'cooldown', 'delay', 'preventRecursion', 'excludeRecursion'
]);

export function lineDiff(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ t: 'same', s: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ t: 'del', s: a[i++] });
    } else {
      out.push({ t: 'add', s: b[j++] });
    }
  }
  while (i < a.length) out.push({ t: 'del', s: a[i++] });
  while (j < b.length) out.push({ t: 'add', s: b[j++] });
  return out;
}

export function computeBookDiff(oldData, newData) {
  const oldEntries = oldData?.entries || {};
  const newEntries = newData?.entries || {};
  const added = [];
  const removed = [];
  const changed = [];

  for (const uid of Object.keys(newEntries)) {
    if (!oldEntries[uid]) added.push(newEntries[uid]);
  }
  for (const uid of Object.keys(oldEntries)) {
    if (!newEntries[uid]) removed.push(oldEntries[uid]);
  }
  for (const uid of Object.keys(oldEntries)) {
    if (!newEntries[uid]) continue;
    const before = oldEntries[uid];
    const after = newEntries[uid];
    const fields = [];
    for (const field of DIFF_FIELDS) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
        fields.push({ f: field, a: before[field], b: after[field] });
      }
    }
    if (JSON.stringify(before.key || []) !== JSON.stringify(after.key || [])) {
      fields.push({ f: 'key', a: before.key || [], b: after.key || [] });
    }
    if (fields.length) {
      changed.push({
        uid,
        title: after.comment || before.comment || '#' + uid,
        fields
      });
    }
  }
  return { added, removed, changed };
}

export function formatVersionTime(value, locale = 'zh-CN') {
  const date = new Date(String(value).replace(' ', 'T') + 'Z');
  return date.toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function createVersionHistoryController({
  $,
  escHtml,
  apiRequest,
  getCurrentBookId,
  getWorldBook,
  loadBookList,
  loadBook,
  renderSidebar,
  selectEntry,
  renderEditorEmpty,
  ensureMemoryLoaded,
  showToast,
  confirmFn = message => globalThis.confirm(message)
} = {}) {
  if (typeof $ !== 'function') throw new TypeError('version history requires $');
  if (typeof apiRequest !== 'function') throw new TypeError('version history requires apiRequest');

  function renderDiff(version) {
    const title = $('diffTitle');
    const summary = $('diffSummary');
    const content = $('diffContent');
    const diffModal = $('diffModal');
    if (diffModal) diffModal.dataset.vid = version.id;

    const bookId = getCurrentBookId();
    if (title) title.textContent = '版本 #' + version.id + ' 对比 当前';
    if (!bookId) return;

    const current = getWorldBook() || {};
    const diff = computeBookDiff(version.data, current);
    if (summary) {
      summary.innerHTML =
        '<span class="diff-stat add">+' + diff.added.length + ' 新增</span>' +
        '<span class="diff-stat del">−' + diff.removed.length + ' 删除</span>' +
        '<span class="diff-stat mod">~' + diff.changed.length + ' 修改</span>' +
        '<small>（' + version.entry_count + ' 条 → 当前 ' + Object.keys(current.entries || {}).length + ' 条）</small>';
    }

    let html = '';
    const esc = escHtml;
    for (const entry of diff.added) {
      html += '<div class="diff-entry add"><b>＋ ' + esc(entry.comment || '(无标题)') +
        '</b><small>当前有、版本没有（新增条目）</small></div>';
    }
    for (const entry of diff.removed) {
      html += '<div class="diff-entry del"><b>－ ' + esc(entry.comment || '(无标题)') +
        '</b><small>版本有、当前没有（已删除）</small></div>';
    }
    for (const change of diff.changed) {
      html += '<div class="diff-entry mod"><b>~ ' + esc(change.title) + '</b>';
      for (const field of change.fields) {
        if (field.f === 'content') {
          const lines = lineDiff(field.a, field.b);
          const changedLines = lines.filter(line => line.t !== 'same');
          html += '<div class="diff-lines">' + changedLines.slice(0, 60).map(line =>
            '<div class="diff-line ' + line.t + '">' + (line.t === 'add' ? '+' : '−') + ' ' + esc(line.s) + '</div>'
          ).join('') + (changedLines.length > 60 ? '<div class="diff-more">…还有更多变化</div>' : '') + '</div>';
        } else {
          html += '<div class="diff-field"><span class="diff-fname">' + esc(field.f) + '</span>' +
            '<span class="diff-old">' + esc(JSON.stringify(field.a)) + '</span>' +
            '<span class="diff-arrow">→</span>' +
            '<span class="diff-new">' + esc(JSON.stringify(field.b)) + '</span></div>';
        }
      }
      html += '</div>';
    }
    if (!html) html = '<div class="diff-empty">两个版本内容完全相同</div>';
    if (content) content.innerHTML = html;
  }

  async function loadVersions() {
    const bookId = getCurrentBookId();
    if (bookId == null) return [];
    const result = await apiRequest('GET', '/api/books/' + bookId + '/versions');
    return Array.isArray(result) ? result : [];
  }

  async function rollback(bookId, versionId) {
    try {
      const result = await apiRequest('POST', '/api/books/' + bookId + '/rollback', { vid: versionId });
      showToast('已回滚到版本 #' + versionId + '（' + result.entry_count + ' 条）', 'success');
      await loadBookList();
      await loadBook(bookId, renderSidebar, selectEntry, renderEditorEmpty);
      ensureMemoryLoaded();
      const versionsModal = $('versionsModal');
      if (versionsModal) versionsModal.classList.remove('open');
    } catch (error) {
      showToast('回滚失败: ' + error.message, 'error');
    }
  }

  async function openVersions() {
    const modal = $('versionsModal');
    const list = $('versionsList');
    if (!modal || !list) return;
    const nameEl = $('versionsBookName');
    if (nameEl) nameEl.textContent = $('file-name')?.textContent || '未命名';
    list.innerHTML = '<div class="version-empty">加载中…</div>';
    modal.classList.add('open');
    try {
      const versions = await loadVersions();
      if (!versions.length) {
        list.innerHTML = '<div class="version-empty">暂无历史版本。编辑并保存世界书后，每次内容变化会自动生成快照。</div>';
        return;
      }
      list.innerHTML = versions.map(version =>
        '<div class="version-item" data-vid="' + version.id + '">' +
          '<div class="version-main">' +
            '<strong>#' + version.id + (version.kind === 'manual' ? ' <span class="version-tag">手动</span>' : '') + '</strong>' +
            '<small>' + formatVersionTime(version.created_at) + ' · ' + version.entry_count + ' 条' +
              (version.note ? ' · ' + escHtml(version.note) : '') + '</small>' +
            (Array.isArray(version.titles) && version.titles.length
              ? '<span class="version-titles">' + version.titles.map(title => escHtml(title)).join('、') +
                (version.entry_count > 3 ? '…' : '') + '</span>'
              : '') +
          '</div>' +
          '<div class="version-actions">' +
            '<button class="action version-preview" data-preview="' + version.id + '">预览</button>' +
            '<button class="action danger version-rollback" data-rollback="' + version.id + '">回滚</button>' +
          '</div>' +
        '</div>'
      ).join('');
    } catch (error) {
      list.innerHTML = '<div class="version-empty">加载失败: ' + escHtml(error.message) + '</div>';
    }
  }

  function bind() {
    const openBtn = $('versionsBtn');
    const modal = $('versionsModal');
    const list = $('versionsList');
    if (!openBtn || !modal || !list) return;

    openBtn.addEventListener('click', openVersions);
    $('editorVersionsBtn')?.addEventListener('click', openVersions);

    list.addEventListener('click', async event => {
      const bookId = getCurrentBookId();
      if (bookId == null) return;
      const previewBtn = event.target.closest('.version-preview');
      const rollbackBtn = event.target.closest('.version-rollback');
      if (previewBtn) {
        try {
          const version = await apiRequest('GET', '/api/books/' + bookId + '/versions/' + previewBtn.dataset.preview);
          renderDiff(version);
          $('diffModal')?.classList.add('open');
        } catch (error) {
          showToast('预览失败: ' + error.message, 'error');
        }
      } else if (rollbackBtn) {
        const versionId = Number(rollbackBtn.dataset.rollback);
        if (!confirmFn('确认回滚到版本 #' + versionId + '？\n当前状态会先自动备份，不会丢失。')) return;
        rollback(bookId, versionId);
      }
    });

    const diffModal = $('diffModal');
    $('diffBackBtn')?.addEventListener('click', () => diffModal?.classList.remove('open'));
    $('diffRollbackBtn')?.addEventListener('click', () => {
      const versionId = diffModal?.dataset.vid;
      const bookId = getCurrentBookId();
      if (!versionId || bookId == null) return;
      if (!confirmFn('确认回滚到版本 #' + versionId + '？\n当前状态会先自动备份，不会丢失。')) return;
      diffModal.classList.remove('open');
      rollback(bookId, Number(versionId));
    });
  }

  return { bind, openVersions, renderDiff, loadVersions, rollback };
}
