// ===== Editor 屏（杂志风：完整 42 字段，核心可见 + 高级折叠） =====
import { escHtml, escAttr, $, showConfirm } from './utils.js';
import { worldBook, entries, currentUid, nextUid, createEntry, uidKey, setEntries, snapshotForUndo } from './state.js';
import { scheduleSave } from './api.js';
import { renderSidebar, selectEntry } from './sidebar.js';

function pad2(n) { return String(n).padStart(2, '0'); }
function dyn() { return $('editorDynamic'); }
function strip() { return $('saveStrip'); }

// ===== 空编辑器 =====
export function renderEditorEmpty() {
  const d = dyn();
  if (d) d.innerHTML = '<div class="editor-empty"><p>从书库选择一个条目，或点「＋」新建。</p></div>';
  const s = strip();
  if (s) s.hidden = true;
}

// 标题输入时延迟重建侧栏，避免每键全量 innerHTML 重建 Library 屏（大书时卡顿）
let titleSidebarTimer = null;

// ===== 渲染编辑器 =====
export function renderEditor(entry) {
  const d = dyn();
  if (!d) return;
  if (titleSidebarTimer) { clearTimeout(titleSidebarTimer); titleSidebarTimer = null; } // 切条目时取消残留的防抖

  const title = entry.comment || '';
  const content = entry.content || '';

  d.innerHTML = [
    '<div class="editor-index"><span>Entry</span><strong>#' + pad2(entry.uid) + '</strong></div>',
    '<textarea class="editor-title" id="ed-title" rows="1" placeholder="条目标题…">' + escHtml(title) + '</textarea>',
    '<div class="editor-rule"></div>',

    '<div class="body-label"><span>正文 · BODY</span><span id="ed-charpill">' + content.length + ' 字符</span></div>',

    '<div class="body-editor">',
      '<div class="line-nos" id="ed-lines"></div>',
      '<textarea id="ed-content" spellcheck="false" placeholder="写下这条世界设定…">' + escHtml(content) + '</textarea>',
    '</div>',

    // 触发词
    '<div class="inspector">',
      '<div class="inspector-section">',
        '<div class="inspector-title"><span>主触发词 · Primary keys</span><span>回车添加</span></div>',
        '<div class="keyword-list" id="ed-keys">' + kwChips(entry.key, 'accent') +
          '<input class="kw-add-input" id="ed-key-add" placeholder="+ 关键词">' +
        '</div>',
      '</div>',
      '<div class="inspector-section">',
        '<div class="inspector-title"><span>次要触发词 · Secondary</span><span>AND 逻辑</span></div>',
        '<div class="keyword-list" id="ed-skeys">' + kwChips(entry.keysecondary, 'secondary') +
          '<input class="kw-add-input" id="ed-skey-add" placeholder="+ 次要词">' +
        '</div>',
      '</div>',

      // 核心参数
      '<div class="inspector-section">',
        '<div class="inspector-title"><span>注入设置 · Placement</span></div>',
        '<div class="select-row">',
          selectBox('Position', 'position', posOptions(entry.position), true),
          numBox('Depth 深度', 'depth', entry.depth),
        '</div>',
        '<div class="select-row">',
          numBox('Order 优先级', 'order', entry.order),
          numBox('Probability %', 'probability', entry.probability),
        '</div>',
      '</div>',

      // 核心开关
      '<div class="inspector-section">',
        '<div class="inspector-title"><span>状态 · State</span></div>',
        swRow('常驻激活 Constant', 'constant', entry.constant),
        swRow('禁用 Disable', 'disable', entry.disable),
        swRow('选择性 Selective', 'selective', entry.selective),
        swRow('显示备注 addMemo', 'addMemo', entry.addMemo),
      '</div>',

      // 高级（其余字段）
      advancedSection(entry),
    '</div>'
  ].join('');

  const s = strip();
  if (s) s.hidden = false;

  bindEditorEvents(entry);
  autoSizeTitle();
  refreshLines();
}

// ===== 关键词 chips（整颗 chip 即删除按钮） =====
function kwChips(arr, cls) {
  const list = arr || [];
  if (!list.length) return '';
  return list.map(k =>
    '<button type="button" class="keyword ' + cls + '" data-kw="' + escAttr(k) + '" aria-label="删除关键词 ' + escAttr(k) + '">' +
    escHtml(k) + '<span class="kw-x">×</span></button>'
  ).join('');
}

// ===== 表单 helpers =====
function selectBox(label, field, optionsHtml) {
  return '<label class="select-box"><span>' + label + '</span>' +
    '<select data-field="' + field + '">' + optionsHtml + '</select></label>';
}
function numBox(label, field, value) {
  const v = value != null ? value : '';
  return '<label class="select-box"><span>' + label + '</span>' +
    '<input type="number" data-field="' + field + '" value="' + v + '"></label>';
}
function swRow(label, field, value) {
  return '<div class="swrow"><span>' + label + '</span>' +
    '<button class="switch' + (value ? '' : ' off') + '" data-toggle="' + field + '"' +
    ' role="switch" aria-checked="' + (value ? 'true' : 'false') + '" aria-label="' + escAttr(label) + '"></button></div>';
}
function posOptions(cur) {
  const opts = [[0,'0 · 角色定义前'],[1,'1 · 角色定义后'],[2,'2 · 作者注释前'],[3,'3 · 作者注释后'],[4,'4 · @D 注入'],[5,'5 · 对话示例']];
  return opts.map(([v,l]) => '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + l + '</option>').join('');
}
function fld(label, field, value, type) {
  const v = value != null ? value : '';
  return '<div class="fld"><label>' + label + '</label>' +
    '<input type="' + (type || 'text') + '" data-field="' + field + '" value="' + escAttr(v) + '"></div>';
}
function selFld(label, field, optionsHtml) {
  return '<div class="fld"><label>' + label + '</label>' +
    '<select data-field="' + field + '">' + optionsHtml + '</select></div>';
}
function selOpt(val, label, current) {
  return '<option value="' + val + '"' + (current === val ? ' selected' : '') + '>' + label + '</option>';
}
function triBool(field, current) {
  const sc = current === null || current === undefined ? '' : String(current);
  const o = (sv, label) => '<option value="' + sv + '"' + (sv === sc ? ' selected' : '') + '>' + label + '</option>';
  return o('', '自动') + o('true', '是') + o('false', '否');
}

// ===== 高级字段区 =====
function advancedSection(entry) {
  return '<details class="adv"><summary>高级字段 · Advanced (全部 42 项)</summary>' +
    '<div class="adv-block">' +

    '<div class="adv-label">逻辑 & 分组</div>' +
    '<div class="adv-grid">' +
      selFld('selectiveLogic', 'selectiveLogic',
        selOpt(0,'AND ANY',entry.selectiveLogic)+selOpt(1,'AND ALL',entry.selectiveLogic)+
        selOpt(2,'NOT ANY',entry.selectiveLogic)+selOpt(3,'NOT ALL',entry.selectiveLogic)) +
      selFld('role', 'role',
        ['', '0', '1', '2'].map(v => {
          const sc = entry.role === null || entry.role === undefined ? '' : String(entry.role);
          const lab = {'':'自动','0':'系统','1':'用户','2':'助手'}[v];
          return '<option value="' + v + '"' + (v === sc ? ' selected' : '') + '>' + lab + '</option>';
        }).join('')) +
      fld('group 分组', 'group', entry.group) +
      fld('groupWeight', 'groupWeight', entry.groupWeight, 'number') +
    '</div>' +

    '<div class="adv-label">时序</div>' +
    '<div class="adv-grid">' +
      fld('sticky 粘性', 'sticky', entry.sticky, 'number') +
      fld('cooldown 冷却', 'cooldown', entry.cooldown, 'number') +
      fld('delay 延迟', 'delay', entry.delay, 'number') +
      fld('scanDepth', 'scanDepth', entry.scanDepth, 'number') +
    '</div>' +

    '<div class="adv-label">匹配选项</div>' +
    '<div class="adv-grid">' +
      selFld('caseSensitive', 'caseSensitive', triBool('caseSensitive', entry.caseSensitive)) +
      selFld('matchWholeWords', 'matchWholeWords', triBool('matchWholeWords', entry.matchWholeWords)) +
      selFld('useGroupScoring', 'useGroupScoring', triBool('useGroupScoring', entry.useGroupScoring)) +
      fld('automationId', 'automationId', entry.automationId) +
    '</div>' +

    '<div class="adv-label">布尔开关</div>' +
      swRow('groupOverride 分组覆盖', 'groupOverride', entry.groupOverride) +
      swRow('useProbability 使用概率', 'useProbability', entry.useProbability) +
      swRow('vectorized 向量化', 'vectorized', entry.vectorized) +
      swRow('excludeRecursion 排除递归', 'excludeRecursion', entry.excludeRecursion) +
      swRow('preventRecursion 阻止递归', 'preventRecursion', entry.preventRecursion) +
      swRow('delayUntilRecursion 递归延迟', 'delayUntilRecursion', entry.delayUntilRecursion) +
      swRow('ignoreBudget 忽略预算', 'ignoreBudget', entry.ignoreBudget) +

    '<div class="adv-label">匹配范围</div>' +
      swRow('matchPersonaDescription', 'matchPersonaDescription', entry.matchPersonaDescription) +
      swRow('matchCharacterDescription', 'matchCharacterDescription', entry.matchCharacterDescription) +
      swRow('matchCharacterPersonality', 'matchCharacterPersonality', entry.matchCharacterPersonality) +
      swRow('matchCharacterDepthPrompt', 'matchCharacterDepthPrompt', entry.matchCharacterDepthPrompt) +
      swRow('matchScenario', 'matchScenario', entry.matchScenario) +
      swRow('matchCreatorNotes', 'matchCreatorNotes', entry.matchCreatorNotes) +

    '<div class="adv-label">其他</div>' +
    '<div class="adv-grid">' +
      fld('outletName', 'outletName', entry.outletName) +
      fld('displayIndex', 'displayIndex', entry.displayIndex, 'number') +
    '</div>' +

    '</div></details>';
}

// ===== 行号 =====
function refreshLines() {
  const ta = $('ed-content');
  const ln = $('ed-lines');
  if (!ta || !ln) return;
  const n = ta.value.split('\n').length || 1;
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  ln.textContent = s;
}

export function autoSizeTitle() {
  const t = $('ed-title');
  if (!t) return;
  t.style.height = 'auto';
  // 屏幕隐藏时 scrollHeight 为 0，别把高度写死成 0px 导致标题被裁没
  const h = t.scrollHeight;
  if (h > 0) t.style.height = h + 'px';
}

// ===== 事件绑定 =====
function bindEditorEvents(entry) {
  // 标题
  const title = $('ed-title');
  if (title) {
    title.addEventListener('input', () => {
      entry.comment = title.value;
      autoSizeTitle();
      if (titleSidebarTimer) clearTimeout(titleSidebarTimer);
      titleSidebarTimer = setTimeout(() => {
        titleSidebarTimer = null;
        renderSidebar();
      }, 200);
      scheduleSave();
    });
  }

  // 正文
  const content = $('ed-content');
  if (content) {
    content.addEventListener('input', () => {
      entry.content = content.value;
      const pill = $('ed-charpill');
      if (pill) pill.textContent = content.value.length + ' 字符';
      refreshLines();
      scheduleSave();
    });
    content.addEventListener('scroll', () => {
      const ln = $('ed-lines');
      if (ln) ln.scrollTop = content.scrollTop;
    });
  }

  // 开关（核心 + 高级）
  dyn().querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.toggle;
      btn.classList.toggle('off');
      btn.setAttribute('aria-checked', btn.classList.contains('off') ? 'false' : 'true');
      entry[field] = !btn.classList.contains('off');
      if (['disable', 'constant'].includes(field)) renderSidebar();
      scheduleSave();
    });
  });

  // 输入 / 下拉
  dyn().querySelectorAll('[data-field]').forEach(el => {
    if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') return;
    el.addEventListener('change', () => {
      const field = el.dataset.field;
      const v = el.value;
      if (el.tagName === 'SELECT' && ['caseSensitive','matchWholeWords','useGroupScoring'].includes(field)) {
        entry[field] = v === '' ? null : v === 'true';
      } else if (field === 'role') {
        entry[field] = v === '' ? null : parseInt(v);
      } else if (field === 'scanDepth') {
        entry[field] = v === '' ? null : (parseFloat(v) || 0);
      } else if (el.type === 'number' || ['position','selectiveLogic'].includes(field)) {
        entry[field] = v === '' ? 0 : (parseFloat(v) || 0);
      } else {
        entry[field] = v;
      }
      if (['constant','disable'].includes(field)) renderSidebar();
      scheduleSave();
    });
  });

  // 关键词：删除
  bindKwRemove('ed-keys', entry, 'key');
  bindKwRemove('ed-skeys', entry, 'keysecondary');
  // 关键词：添加
  bindKwAdd('ed-key-add', entry, 'key');
  bindKwAdd('ed-skey-add', entry, 'keysecondary');
}

function bindKwRemove(containerId, entry, field) {
  const box = $(containerId);
  if (!box) return;
  box.querySelectorAll('.keyword').forEach(chip => {
    chip.addEventListener('click', () => {
      snapshotForUndo('删除关键词');
      const k = chip.dataset.kw;
      entry[field] = (entry[field] || []).filter(x => x !== k);
      renderEditor(entry);
      if (field === 'key') renderSidebar();
      scheduleSave();
    });
  });
}

function bindKwAdd(inputId, entry, field) {
  const inp = $(inputId);
  if (!inp) return;
  inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = inp.value.trim();
    if (!v) return;
    entry[field] = entry[field] || [];
    if (!entry[field].includes(v)) entry[field].push(v);
    renderEditor(entry);
    if (field === 'key') renderSidebar();
    scheduleSave();
    // 重新聚焦到对应输入
    const again = $(inputId);
    if (again) again.focus();
  });
}

// ===== 新建条目 =====
export function newEntry(title) {
  if (!worldBook) {
    import('./state.js').then(m => {
      m.setWorldBook(m.createEmptyWorldBook());
      _addEntry(title, m);
    });
    return;
  }
  _addEntry(title);
}

function _addEntry(title, m) {
  const uid = nextUid();
  const entry = createEntry(uid);
  if (title) entry.comment = title;
  worldBook.entries[uidKey(uid)] = entry;
  entries.push(entry);
  renderSidebar();
  selectEntry(uid);
  import('./utils.js').then(u => u.showToast('已创建条目 #' + uid, 'success'));
  scheduleSave();
}

// ===== 删除条目 =====
export async function deleteEntry() {
  if (currentUid == null || !worldBook) return;
  const entry = entries.find(e => e.uid === currentUid);
  const title = entry ? (entry.comment || 'UID ' + currentUid) : '#' + currentUid;
  const ok = await showConfirm({
    title: '删除条目',
    message: '确定删除「' + title + '」？该操作不可撤销，但可用 Ctrl/Cmd+Z 撤销。',
    okText: '删除',
    danger: true
  });
  if (!ok) return;
  snapshotForUndo('删除条目');
  delete worldBook.entries[uidKey(currentUid)];
  const remaining = entries.filter(e => e.uid !== currentUid);
  setEntries(remaining);
  import('./state.js').then(m => m.setCurrentUid(null));
  renderSidebar();
  if (remaining.length > 0) selectEntry(remaining[0].uid);
  else renderEditorEmpty();
  import('./utils.js').then(m => m.showToast('已删除「' + title + '」', 'success'));
  scheduleSave();
}

// ===== 复制条目 =====
export function duplicateEntry() {
  if (currentUid == null || !worldBook) return;
  const src = entries.find(e => e.uid === currentUid);
  if (!src) return;
  snapshotForUndo('复制条目');
  const uid = nextUid();
  const copy = JSON.parse(JSON.stringify(src));
  copy.uid = uid;
  copy.comment = (copy.comment || '') + ' (副本)';
  worldBook.entries[uidKey(uid)] = copy;
  entries.push(copy);
  renderSidebar();
  selectEntry(uid);
  import('./utils.js').then(m => m.showToast('已复制为 #' + uid, 'success'));
  scheduleSave();
}
