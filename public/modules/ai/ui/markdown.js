import { escHtml, escUrl } from '../../utils.js';

// Chat Markdown renderer. Input is model/user text; all HTML/URLs must remain escaped here.
// ===== 格式化聊天文本（简单 markdown） =====
export function mdInline(s) {
  // 已是转义后的文本，处理行内 markdown
  s = s.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // 链接 URL 必须经 escUrl 转义 + 协议白名单（http/https/mailto），
  // 否则 AI 输出的 [x](https://a.com/"onmouseover="alert(1)) 可属性注入窃取 localStorage
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const safeUrl = escUrl(url);
    return safeUrl ? '<a href="' + safeUrl + '" target="_blank" rel="noopener">' + label + '</a>' : m;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s;
}

export function formatChatText(text) {
  if (!text) return '';
  // 先抽出围栏代码块，避免被行级规则破坏
  const blocks = [];
  let src = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push('<pre><code>' + escHtml(code.replace(/\n$/, '')) + '</code></pre>');
    return ' B' + (blocks.length - 1) + ' ';
  });

  const lines = src.split('\n');
  let html = '';
  let listType = null; // 'ul' | 'ol'
  const closeList = () => { if (listType) { html += '</' + listType + '>'; listType = null; } };
  const splitRow = (s) => s.replace(/^\s*\|?/, '').replace(/\|?\s*$/, '').split('|').map(c => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const ph = raw.match(/^ B(\d+) $/);
    if (ph) { closeList(); html += blocks[+ph[1]]; continue; }

    const line = raw;
    if (/^\s*$/.test(line)) { closeList(); continue; }

    // GFM 表格：当前行含 |，下一行是分隔行(---/:---:)
    const next = lines[i + 1];
    if (line.includes('|') && next && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(next) && next.includes('-')) {
      closeList();
      const headers = splitRow(line);
      const aligns = splitRow(next).map(c => {
        const l = c.startsWith(':'), r = c.endsWith(':');
        return r && l ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      const al = (c) => aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '';
      let tbl = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
      headers.forEach((h, c) => { tbl += '<th' + al(c) + '>' + mdInline(escHtml(h)) + '</th>'; });
      tbl += '</tr></thead><tbody>';
      let j = i + 2;
      for (; j < lines.length && lines[j].includes('|') && !/^\s*$/.test(lines[j]); j++) {
        const cells = splitRow(lines[j]);
        tbl += '<tr>';
        for (let c = 0; c < headers.length; c++) tbl += '<td' + al(c) + '>' + mdInline(escHtml(cells[c] || '')) + '</td>';
        tbl += '</tr>';
      }
      tbl += '</tbody></table></div>';
      html += tbl;
      i = j - 1;
      continue;
    }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList();
      const lv = m[1].length;
      html += '<h' + lv + ' class="md-h">' + mdInline(escHtml(m[2])) + '</h' + lv + '>';
    } else if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      closeList(); html += '<hr class="md-hr">';
    } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
      closeList(); html += '<blockquote class="md-quote">' + mdInline(escHtml(m[1])) + '</blockquote>';
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      if (listType !== 'ul') { closeList(); html += '<ul class="md-list">'; listType = 'ul'; }
      html += '<li>' + mdInline(escHtml(m[1])) + '</li>';
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (listType !== 'ol') { closeList(); html += '<ol class="md-list">'; listType = 'ol'; }
      html += '<li>' + mdInline(escHtml(m[1])) + '</li>';
    } else {
      closeList(); html += '<p class="md-p">' + mdInline(escHtml(line)) + '</p>';
    }
  }
  closeList();
  return html;
}
