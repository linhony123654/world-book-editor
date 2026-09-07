// ===== Read-only world-book tools =====
// Pure analysis/query helpers. They never mutate entries and never touch DOM/storage/network state.

function all(list) {
  return Array.isArray(list) ? list : [];
}

export function applyEntryFilter(list, filter) {
  let out = all(list);
  if (!filter) return out;
  if (filter.constant !== undefined) out = out.filter(e => e.constant === filter.constant);
  if (filter.disable !== undefined) out = out.filter(e => e.disable === filter.disable);
  if (filter.uid_range) {
    const [min, max] = filter.uid_range;
    out = out.filter(e => e.uid >= min && e.uid <= max);
  }
  if (filter.query) {
    const q = String(filter.query).toLowerCase();
    out = out.filter(e =>
      (e.comment || '').toLowerCase().includes(q) ||
      (e.key || []).some(k => String(k).toLowerCase().includes(q)) ||
      (e.content || '').toLowerCase().includes(q)
    );
  }
  return out;
}

export function searchEntries(list, { query, filter, type, includeContent } = {}) {
  let out = all(list);
  if (filter === 'constant') out = out.filter(e => e.constant && !e.disable);
  else if (filter === 'keyword') out = out.filter(e => !e.constant && !e.disable);
  else if (filter === 'disabled') out = out.filter(e => e.disable);

  if (type) {
    const t = String(type).toLowerCase();
    out = out.filter(e => {
      const wbe = (e.extensions && e.extensions.wbe) || {};
      return wbe.semanticType === t || String(wbe.customType || '').toLowerCase().includes(t);
    });
  }
  if (query) {
    const q = String(query).toLowerCase();
    out = out.filter(e =>
      (e.comment || '').toLowerCase().includes(q) ||
      (e.key || []).some(k => String(k).toLowerCase().includes(q)) ||
      (e.content || '').toLowerCase().includes(q)
    );
  }

  const summary = '找到 ' + out.length + ' 条';
  if (includeContent) {
    const shown = out.slice(0, 8);
    let detail = shown.map(e => {
      const flag = e.disable ? '[禁]' : (e.constant ? '[常驻]' : '');
      return '#' + e.uid + ' ' + flag + ' ' + (e.comment || '(无标题)') +
        (Array.isArray(e.key) && e.key.length ? ' 关键词:' + e.key.join('/') : '') +
        '\n' + String(e.content || '');
    }).join('\n\n');
    if (out.length > shown.length) detail += '\n\n... 还有 ' + (out.length - shown.length) + ' 条未显示，可缩小关键词后再次搜索';
    return { summary, detail: detail || '(无条目)' };
  }

  const shown = out.slice(0, 20);
  let detail = shown.map(e => '#' + e.uid + ' ' + (e.comment || '')).join('\n');
  if (out.length > shown.length) detail += '\n... 还有 ' + (out.length - shown.length) + ' 条未显示，可缩小关键词或用 list_entries 查看';
  return { summary, detail };
}

export function getEntry(list, { uid } = {}) {
  const entry = all(list).find(e => e.uid === uid);
  if (!entry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  return { summary: '#' + uid + ' ' + (entry.comment || ''), detail: JSON.stringify(entry, null, 2) };
}

export function listEntries(list, { filter, limit } = {}) {
  let out = all(list);
  if (filter === 'constant') out = out.filter(e => e.constant && !e.disable);
  else if (filter === 'keyword') out = out.filter(e => !e.constant && !e.disable);
  else if (filter === 'disabled') out = out.filter(e => e.disable);
  out = out.slice().sort((a, b) => a.uid - b.uid);
  const lim = Math.max(1, Number(limit) || 100);
  const shown = out.slice(0, lim);
  let detail = shown.map(e => {
    const flag = e.disable ? '[禁]' : (e.constant ? '[常驻]' : '');
    return '#' + e.uid + ' ' + flag + ' ' + (e.comment || '(无标题)');
  }).join('\n');
  if (out.length > shown.length) detail += '\n... 还有 ' + (out.length - shown.length) + ' 条未显示（可调大 limit）';
  return { summary: '共 ' + out.length + ' 条', detail: detail || '(无条目)' };
}

function normalizeText(s) {
  return String(s || '').replace(/[\s，。、,.!！?？:：;；"'“”‘’()[\]【】\-—_]/g, '').toLowerCase();
}

export function findDuplicates(list, { limit } = {}) {
  const source = all(list);
  const pairs = [];
  const seen = new Set();
  const cap = limit && limit > 0 ? Math.min(limit, 20) : 10;
  for (let i = 0; i < source.length; i++) {
    for (let j = i + 1; j < source.length; j++) {
      const a = source[i], b = source[j];
      const key = a.uid < b.uid ? a.uid + '-' + b.uid : b.uid + '-' + a.uid;
      if (seen.has(key)) continue;
      const na = normalizeText(a.comment), nb = normalizeText(b.comment);
      let reason = '', score = 0;
      if (na && na === nb) { reason = '标题完全相同'; score = 1; }
      else if (na && nb && (na.includes(nb) || nb.includes(na))) { reason = '标题互为包含'; score = 0.8; }
      if (score < 1) {
        const ka = new Set((a.key || []).map(normalizeText).filter(Boolean));
        const overlap = (b.key || []).map(normalizeText).filter(k => k && ka.has(k)).length;
        if (overlap >= 2) { reason = '关键词重叠 ' + overlap + ' 个'; score = Math.max(score, 0.7); }
        const ca = normalizeText(a.content).slice(0, 80), cb = normalizeText(b.content).slice(0, 80);
        if (ca && ca === cb) { reason = '正文开头相同'; score = Math.max(score, 0.8); }
      }
      if (score > 0) {
        seen.add(key);
        pairs.push({ uidA: a.uid, uidB: b.uid, commentA: a.comment || '(无题)', commentB: b.comment || '(无题)', reason, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const shown = pairs.slice(0, cap);
  return {
    summary: '发现 ' + pairs.length + ' 组疑似重复',
    detail: (shown.length
      ? shown.map(p => '#' + p.uidA + '「' + p.commentA + '」 ↔ #' + p.uidB + '「' + p.commentB + '」 — ' + p.reason).join('\n')
      : '未发现重复。可配合 merge_entries 合并确认重复的条目。') +
      (pairs.length > shown.length ? '\n…还有 ' + (pairs.length - shown.length) + ' 组未列出' : '')
  };
}

export function contentSimilarity(a, b) {
  const grams = s => {
    const t = String(s || '').replace(/\s+/g, '');
    if (!t) return new Set();
    if (t.length < 2) return new Set([t]);
    const set = new Set();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export function checkEntries(list) {
  const source = all(list);
  const issues = [];
  const byKey = new Map();
  const byTitle = new Map();

  for (const entry of source) {
    const title = String(entry.comment || '').trim();
    if (title) {
      const t = title.toLowerCase();
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push(entry.uid);
    }
    for (const k of (Array.isArray(entry.key) ? entry.key : [])) {
      const key = String(k).toLowerCase().trim();
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(entry.uid);
    }
  }

  const emittedShared = new Set();
  for (const entry of source) {
    const tag = '#' + entry.uid + '「' + (entry.comment || '(无标题)') + '」';
    const active = !entry.disable;
    const keys = (Array.isArray(entry.key) ? entry.key : []).map(k => String(k).trim()).filter(Boolean);
    const wbe = (entry.extensions && entry.extensions.wbe) || {};
    if (!String(entry.content || '').trim()) issues.push('[空正文] ' + tag + (wbe.semanticType ? '（类型: ' + wbe.semanticType + '）' : ''));
    if (active && !entry.constant && keys.length === 0) issues.push('[永不触发] ' + tag + ' 无关键词且非常驻，永远不会被注入');
    for (const k of keys) {
      if (k.length <= 1) issues.push('[关键词过短] ' + tag + ' 关键词「' + k + '」只有 ' + k.length + ' 个字，容易误触发');
      const holders = (byKey.get(k.toLowerCase()) || []).filter(uid => uid !== entry.uid && !source.find(x => x.uid === uid)?.disable);
      for (const h of holders) {
        const pairKey = [entry.uid, h].sort((a, b) => a - b).join(':') + ':' + k.toLowerCase();
        if (emittedShared.has(pairKey)) continue;
        emittedShared.add(pairKey);
        const other = source.find(x => x.uid === h);
        const sim = contentSimilarity(entry.content, other && other.content);
        if (sim > 0.45) {
          issues.push('[关键词冲突] ' + tag + ' 与 #' + h + ' 共用关键词「' + k + '」且内容高度相似(' + Math.round(sim * 100) + '%)，建议合并或调整其中一条');
        } else {
          issues.push('[关键词共享] ' + tag + ' 与 #' + h + ' 共用关键词「' + k + '」（内容不重叠，可能是有意互补——如人物与其装备共享人名，属合理设计，可保留）');
        }
      }
    }
    const dupTitles = (byTitle.get(String(entry.comment || '').toLowerCase()) || []).filter(uid => uid !== entry.uid);
    if (dupTitles.length) issues.push('[标题重复] ' + tag + ' 与 ' + dupTitles.map(h => '#' + h).join('、') + ' 标题相同');
  }

  const byLevel = {};
  for (const line of issues) {
    const level = line.slice(1, line.indexOf(']'));
    byLevel[level] = (byLevel[level] || 0) + 1;
  }
  if (!issues.length) return { summary: '体检通过：' + source.length + ' 条全部健康', detail: '未发现问题。' };
  const levelText = Object.entries(byLevel).map(([level, count]) => level + '×' + count).join('，');
  return { summary: '发现 ' + issues.length + ' 个问题（' + levelText + '）', detail: issues.join('\n') };
}

export function testTriggers(list, { text } = {}) {
  const src = String(text || '');
  if (!src) return { summary: '缺少测试文本', detail: '请提供要测试的场景文本' };
  const lower = src.toLowerCase();
  const hits = [];
  for (const entry of all(list).filter(e => !e.disable)) {
    if (entry.constant) { hits.push({ entry, why: '常驻' }); continue; }
    const matched = (Array.isArray(entry.key) ? entry.key : []).filter(k => {
      const key = String(k).trim().toLowerCase();
      return key && lower.includes(key);
    });
    if (matched.length) hits.push({ entry, why: '关键词: ' + matched.join('/') });
  }
  hits.sort((a, b) => (a.entry.depth || 0) - (b.entry.depth || 0) || (a.entry.order || 0) - (b.entry.order || 0));
  if (!hits.length) return { summary: '无条目触发', detail: '这段文本没有命中任何关键词，也没有常驻条目。' };
  const lines = hits.map((hit, index) =>
    (index + 1) + '. #' + hit.entry.uid + ' ' + (hit.entry.comment || '(无标题)') + ' [' + hit.why + '] (depth=' + (hit.entry.depth || 0) + ', order=' + (hit.entry.order || 0) + ')'
  );
  const constantCount = hits.filter(hit => hit.entry.constant).length;
  return {
    summary: '命中 ' + hits.length + ' 条（常驻 ' + constantCount + '，关键词 ' + (hits.length - constantCount) + '）',
    detail: '注入顺序（先 depth 后 order）:\n' + lines.join('\n')
  };
}

export function bookInfo(list, { name = '未命名', bookId = null } = {}) {
  const source = all(list);
  const constant = source.filter(e => e.constant && !e.disable).length;
  const keyword = source.filter(e => !e.constant && !e.disable).length;
  const disabled = source.filter(e => e.disable).length;
  const byType = {};
  for (const entry of source) {
    const wbe = (entry.extensions && entry.extensions.wbe) || {};
    const type = wbe.semanticType || (entry.disable ? 'disabled' : (entry.constant ? '常驻(未分类)' : '未分类'));
    byType[type] = (byType[type] || 0) + 1;
  }
  const typeLines = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => type + ': ' + count).join('\n');
  return {
    summary: '当前「' + name + '」，' + source.length + ' 条（常驻 ' + constant + ' / 关键词 ' + keyword + ' / 禁用 ' + disabled + '）',
    detail: '书名: ' + name + '\nID: ' + (bookId != null ? bookId : '未知') +
      '\n条目数: ' + source.length +
      '\n常驻: ' + constant + '，关键词触发: ' + keyword + '，禁用: ' + disabled +
      '\n按语义类型分布:\n' + (typeLines || '(无)') +
      '\n提示: 需要看某类条目全文时用 search_entries 的 type + includeContent 参数。'
  };
}
