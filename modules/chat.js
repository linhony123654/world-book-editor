// ===== AI 聊天 =====
import { escHtml, $ } from './utils.js';
import { worldBook, entries, currentUid, currentBookId, nextUid, createEntry, uidKey, setEntries, snapshotForUndo, restoreUndo } from './state.js';
import { renderSidebar, selectEntry } from './sidebar.js';
import { renderEditor, renderEditorEmpty } from './editor.js';
import { scheduleSave, apiRequest, loadBookList, loadBook, createBook, renameBook, deleteBook } from './api.js';
import { summarizeToolTraceForMemory } from './memory-summary.js';
import { planWorldbookEntry } from './worldbook-intelligence/index.js';
import { extractReasoningDelta, hasVisibleAssistantStream, reasoningDetailsShouldBeOpen, shouldCollapseReasoningAfterStream } from './reasoning.js';
import { applyVisibleLimitToChildren, readChatVisibleLimit } from './chat-view.js';
import { applyDraftToEntry, createSmartDraftRecord, draftDisplayRows, formatDecision } from './smart-draft.js';
import { clearActiveSmartDraft, createSmartDraftState, setActiveSmartDraft, takeActiveSmartDraft } from './smart-draft-state.js';
import { WRITING_TEMPLATE_FIELDS, applyWritingTemplateUpdate, buildWritingTemplateGenerationMessages, formatWritingTemplateForTool, loadWritingTemplate, parseWritingTemplateDraft, saveWritingTemplate, selectWritingTemplate } from './writing-template.js';

// ===== 聊天状态 =====
const chatMessages = [];
let chatOpen = false;
const MAX_HISTORY = 40;

// 默认系统提示（设置框占位 + 未配置时兜底都用它）
export const DEFAULT_SYSTEM_PROMPT = '你是一个世界书编辑助手。根据用户指令调用工具完成操作：' +
  '条目级——搜索/查看/新增(单条 add_entry、多条 add_entries)/编辑/批量修改/删除(单条 delete_entry、批量 delete_entries)/启用禁用/排序/复制/撤销；' +
  '智能写作——当用户要求创建人物、地点、组织、规则、事件、物品、关系、文风等设定条目时，复杂条目优先用 plan_smart_entry 生成预览，由用户确认后写入；用户明确要求直接创建时才用 create_smart_entry。你可以根据本书气质自由给出 customType、classificationReason、templateSections 和设置判断矩阵；' +
  '局部修改优先——改正文里的个别词用 replace_text 查找替换（不必整段重写）、增删关键词用 manage_keys、改插入位置用 move_entry；' +
  '整本世界书级——get_book_info 查当前书信息、list_books 列出所有书、switch_book 切换、create_book 新建、rename_book 重命名、delete_book 删除(需 confirm:true)。' +
  '需要一次写入或删除多条时优先用批量工具；改长正文的局部内容时优先 replace_text 而非 edit_entry 整段重写。回复简洁。';
const TOOL_NAMES = ['search_entries','get_entry','edit_entry','add_entry','add_entries','get_writing_template','update_writing_template','plan_smart_entry','create_smart_entry','delete_entry','delete_entries','batch_edit','replace_text','manage_keys','move_entry','list_entries','toggle_entry','reorder_entry','duplicate_entry','undo_last','get_book_info','list_books','switch_book','create_book','rename_book','delete_book'];
const smartDraftState = createSmartDraftState();

// ===== 分层记忆：回合小总结 + AI 大总结，按世界书持久化 =====
// turns: 每回合一条小总结 {user, actionSummary, toolSummary, toolDetail[], reply, ts}
// rollups: 每满 ROLLUP_EVERY 条小总结，AI 浓缩成一段阶段总结 {from, to, text}
// rolledUpCount: 已被大总结覆盖的 turns 前缀数量
let memory = { turns: [], rollups: [], rolledUpCount: 0 };
let logBookId = null;     // 当前已加载记忆的 bookId
let isRollingUp = false;  // 大总结进行中锁
const ROLLUP_EVERY = 10;  // 每满 N 条小总结整合一次

function memKey(bookId) { return 'wbe-memory:' + (bookId || 'unsaved'); }
function emptyMemory() { return { turns: [], rollups: [], rolledUpCount: 0 }; }
function loadMemory(bookId) {
  try {
    const raw = localStorage.getItem(memKey(bookId));
    const m = raw ? JSON.parse(raw) : null;
    memory = m ? { turns: m.turns || [], rollups: m.rollups || [], rolledUpCount: m.rolledUpCount || 0 } : emptyMemory();
  } catch { memory = emptyMemory(); }
  updateMemoryBadge();
}
function saveMemory() {
  try { localStorage.setItem(memKey(logBookId), JSON.stringify(memory)); } catch {}
}
function recentTurns() { return memory.turns.slice(memory.rolledUpCount); }

// ===== 对话历史持久化（按世界书保存，刷新/重开后可继续） =====
function chatKey(bookId) { return 'wbe-chat:' + (bookId || 'unsaved'); }

function loadChatHistory(bookId) {
  try {
    const raw = localStorage.getItem(chatKey(bookId));
    const arr = raw ? JSON.parse(raw) : [];
    chatMessages.length = 0;
    if (Array.isArray(arr)) {
      for (const m of arr) {
        if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
          chatMessages.push({ role: m.role, content: m.content });
        }
      }
    }
  } catch { chatMessages.length = 0; }
}

function saveChatHistory() {
  try { localStorage.setItem(chatKey(logBookId), JSON.stringify(chatMessages)); } catch {}
}

const WELCOME_HTML =
  '<div class="chat-welcome">' +
    '<div class="chat-welcome-mark">“</div>' +
    '<p>用自然语言编辑这本世界书。</p>' +
    '<p class="chat-hint">例如：「新增 3 条关于王城夜禁的设定，重要的设常驻，细节用关键词触发」</p>' +
  '</div>';

// 把当前 chatMessages 渲染进聊天容器（恢复历史用）
function renderChatHistory() {
  const c = $('chat-messages');
  if (!c) return;
  c.innerHTML = WELCOME_HTML;
  for (const m of chatMessages) appendChatMessage(m.role, m.content);
}

// 本回合工具列表浓缩成 "search_entries×3, add_entries×1"
function summarizeTools(trace) {
  if (!trace || !trace.length) return '';
  const counts = {};
  for (const t of trace) {
    const name = t.indexOf(': ') > 0 ? t.slice(0, t.indexOf(': ')) : t;
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts).map(([n, c]) => c > 1 ? n + '×' + c : n).join(', ');
}

// 回合结束记一条小总结（既无工具、回复又空 → 不值得记）
function pushTurnMemory({ user, trace, reply }) {
  const toolSummary = summarizeTools(trace);
  const actionSummary = summarizeToolTraceForMemory(trace);
  const cleanReply = (reply || '').trim();
  if (!actionSummary && (!cleanReply || cleanReply === '(无回复)')) return;
  memory.turns.push({
    user: (user || '').slice(0, 200),
    actionSummary,
    toolSummary,
    toolDetail: (trace || []).slice(-20),
    reply: cleanReply.slice(0, 400),
    ts: Date.now()
  });
  saveMemory();
  updateMemoryBadge();
}

// ===== 记忆角标 + 弹窗 =====
function updateMemoryBadge() {
  const b = $('memBadge');
  if (!b) return;
  const n = memory.turns.length;
  if (n > 0 || memory.rollups.length > 0) {
    b.textContent = isRollingUp ? '…' : (n > 99 ? '99+' : String(n));
    b.hidden = false;
  } else b.hidden = true;
}

function renderMemoryList() {
  const nameEl = $('memBookName');
  if (nameEl) nameEl.textContent = '「' + (($('file-name') && $('file-name').textContent) || '未命名') + '」';
  const list = $('memoryList');
  if (!list) return;
  const recent = recentTurns();
  if (!memory.rollups.length && !recent.length) {
    list.innerHTML = '<div class="memory-empty">暂无记忆。AI 在本书的每个回合会自动记录小总结，每 ' + ROLLUP_EVERY + ' 回合 AI 整合成一段阶段总结。</div>';
    return;
  }
  let html = '';
  if (isRollingUp) html += '<div class="memory-rolling">⟳ 正在整合阶段总结…</div>';
  if (memory.rollups.length) {
    html += '<div class="memory-section-label">阶段总结 · DIGEST</div>';
    html += memory.rollups.map((r, i) =>
      '<div class="memory-rollup"><span class="memory-no">§' + (i + 1) + '</span>' +
      '<div class="memory-copy"><small class="memory-range">回合 ' + (r.from + 1) + '–' + r.to + '</small>' +
      '<p>' + escHtml(r.text) + '</p></div></div>'
    ).join('');
  }
  html += '<div class="memory-section-label">近期记忆 · RECENT</div>';
  if (!recent.length) {
    html += '<div class="memory-empty-mini">（已全部整合进阶段总结）</div>';
  } else {
    html += recent.map((t, i) => {
      const no = memory.rolledUpCount + i + 1;
      const tools = t.toolSummary ? '<small class="memory-tools">🔧 ' + escHtml(t.toolSummary) + '</small>' : '';
      const action = t.actionSummary ? '<small class="memory-action">' + escHtml(t.actionSummary) + '</small>' : '';
      const detail = (t.toolDetail && t.toolDetail.length)
        ? '<details class="memory-detail"><summary>工具明细 ' + t.toolDetail.length + '</summary>' +
          t.toolDetail.map(d => '<div>' + escHtml(d) + '</div>').join('') + '</details>'
        : '';
      return '<div class="memory-item"><span class="memory-no">' + no + '</span>' +
        '<div class="memory-copy">' +
        (t.user ? '<strong>' + escHtml(t.user) + '</strong>' : '') +
        action +
        tools +
        (t.reply ? '<small class="memory-reply">' + escHtml(t.reply) + '</small>' : '') +
        detail + '</div></div>';
    }).join('');
  }
  list.innerHTML = html;
}

// ===== 大总结：AI 浓缩（每满 ROLLUP_EVERY 条小总结，后台异步） =====
async function fetchCompletion(messages) {
  const apiUrl = localStorage.getItem('wbe-api-url');
  const apiKey = localStorage.getItem('wbe-api-key');
  const model = localStorage.getItem('wbe-model') || 'gpt-4o';
  if (!apiUrl || !apiKey) throw new Error('未配置 API');
  const resp = await streamFetch(apiUrl, apiKey, { model, messages });
  let content = '';
  for await (const chunk of streamSSE(resp)) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) content += delta.content;
  }
  return content.trim();
}

async function maybeRollup() {
  if (isRollingUp) return;
  if (memory.turns.length - memory.rolledUpCount < ROLLUP_EVERY) return;
  isRollingUp = true;
  updateMemoryBadge();
  if ($('memoryModal') && $('memoryModal').classList.contains('open')) renderMemoryList();

  const from = memory.rolledUpCount;
  const to = from + ROLLUP_EVERY;
  const batch = memory.turns.slice(from, to);
  const prevDigest = memory.rollups.map(r => r.text).join('\n');
  const lines = batch.map((t, i) => {
    const parts = [];
    if (t.user) parts.push('用户：' + t.user);
    if (t.actionSummary) parts.push('操作：' + t.actionSummary);
    else if (t.toolSummary) parts.push('操作：完成了相关查询或修改');
    if (t.reply) parts.push('结果：' + t.reply);
    return (i + 1) + '. ' + parts.join('；');
  }).join('\n');
  const sys = '你是记忆整合器。把用户与世界书编辑助手的若干回合操作记录浓缩成一段简洁的中文阶段总结，' +
    '保留关键的新增/修改/删除的条目名与结论，去掉重复与搜索噪声，不要逐条复述，控制在 150 字内。';
  const usr = (prevDigest ? '已有阶段总结（供衔接，不要重复其内容）：\n' + prevDigest + '\n\n' : '') +
    '需要整合的 ' + ROLLUP_EVERY + ' 个回合：\n' + lines;

  try {
    const text = await fetchCompletion([
      { role: 'system', content: sys },
      { role: 'user', content: usr }
    ]);
    if (text) {
      memory.rollups.push({ from, to, text });
      memory.rolledUpCount = to;
      saveMemory();
    }
  } catch (e) {
    console.warn('[WBE] 记忆整合失败，下回合重试:', e.message);
  } finally {
    isRollingUp = false;
    updateMemoryBadge();
    if ($('memoryModal') && $('memoryModal').classList.contains('open')) renderMemoryList();
  }
}

// 注入 system：所有大总结全文 + 最近未压缩的小总结
function buildMemoryInjection() {
  const parts = [];
  if (memory.rollups.length) {
    parts.push('【长期记忆 · 阶段总结】\n' + memory.rollups.map(r => '· ' + r.text).join('\n'));
  }
  const recent = recentTurns();
  if (recent.length) {
    parts.push('【近期操作（细节，避免重复查询已知信息）】\n' + recent.map((t, i) => {
      const seg = [];
      if (t.actionSummary) seg.push(t.actionSummary);
      else if (t.toolSummary) seg.push('完成了相关查询或修改');
      if (t.reply) seg.push(t.reply);
      return (i + 1) + '. ' + seg.join(' → ');
    }).join('\n'));
  }
  return parts.length ? '\n\n' + parts.join('\n\n') : '';
}

// 确保当前 memory 与 currentBookId 对应（换书/刷新后用）。currentBookId 是 live binding。
export function ensureMemoryLoaded() {
  if (currentBookId !== logBookId) {
    loadMemory(currentBookId);
    loadChatHistory(currentBookId);
    renderChatHistory();
    logBookId = currentBookId;
  }
}

function openMemoryModal() {
  ensureMemoryLoaded();
  renderMemoryList();
  const m = $('memoryModal');
  if (m) m.classList.add('open');
}

function openTemplateModal() {
  renderTemplateForm();
  const m = $('templateModal');
  if (m) m.classList.add('open');
}

function renderTemplateForm() {
  const box = $('templateFields');
  if (!box) return;
  const template = loadWritingTemplate(localStorage, currentBookId);
  box.innerHTML = '<div class="template-tabs">' + WRITING_TEMPLATE_FIELDS.map(([field, label], index) =>
    '<button type="button" class="template-tab' + (index === 0 ? ' active' : '') + '" data-template-tab="' + escHtml(field) + '">' + escHtml(label.replace('模板', '')) + '</button>'
  ).join('') + '</div>' +
  '<div class="template-panes">' + WRITING_TEMPLATE_FIELDS.map(([field, label], index) =>
    '<label class="field template-pane' + (index === 0 ? ' active' : '') + '" data-template-pane="' + escHtml(field) + '"><span>' + escHtml(label) + '</span>' +
    '<textarea class="template-textarea" data-template-field="' + escHtml(field) + '" rows="13" placeholder="例如：\n段落标题：写作要求\n禁忌：不要写空框架，不要泛泛而谈">' + escHtml(template[field] || '') + '</textarea></label>'
  ).join('') + '</div>';
  box.querySelectorAll('[data-template-tab]').forEach(btn => {
    btn.addEventListener('click', () => setTemplateTab(btn.dataset.templateTab));
  });
}

function setTemplateTab(field) {
  document.querySelectorAll('[data-template-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.templateTab === field);
  });
  document.querySelectorAll('[data-template-pane]').forEach(pane => {
    pane.classList.toggle('active', pane.dataset.templatePane === field);
  });
}

function saveTemplateForm() {
  const values = {};
  document.querySelectorAll('[data-template-field]').forEach(el => {
    values[el.dataset.templateField] = el.value;
  });
  saveWritingTemplate(localStorage, currentBookId, values);
  const m = $('templateModal');
  if (m) m.classList.remove('open');
  import('./utils.js').then(m => m.showToast('已保存本书写作模板', 'success'));
}

async function generateTemplateWithAI() {
  const btn = $('generateTemplateBtn');
  const apiUrl = localStorage.getItem('wbe-api-url');
  const apiKey = localStorage.getItem('wbe-api-key');
  const model = localStorage.getItem('wbe-model') || 'gpt-4o';
  if (!apiUrl || !apiKey) {
    import('./utils.js').then(m => m.showToast('请先在设置中配置 API', 'error'));
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '生成中'; }
  try {
    const curBookName = ($('file-name') && $('file-name').textContent) || '未命名';
    const samples = getAllEntries().slice(0, 30).map(e => {
      const keys = Array.isArray(e.key) ? e.key.join('、') : '';
      return '#' + e.uid + ' ' + (e.comment || '(无标题)') + (keys ? ' [' + keys + ']' : '') + '\n' + String(e.content || '').slice(0, 180);
    }).join('\n\n');
    const text = await fetchCompletion(buildWritingTemplateGenerationMessages({ bookName: curBookName, samples }), { model, apiUrl, apiKey });
    applyTemplateDraft(parseWritingTemplateDraft(text));
    import('./utils.js').then(m => m.showToast('已生成模板草稿，请检查后保存', 'success'));
  } catch (e) {
    import('./utils.js').then(m => m.showToast('生成模板失败: ' + e.message, 'error'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'AI 写模板'; }
  }
}

function applyTemplateDraft(template) {
  for (const [field] of WRITING_TEMPLATE_FIELDS) {
    const el = document.querySelector('[data-template-field="' + field + '"]');
    if (el) el.value = template[field] || '';
  }
}

// 对话历史滑动窗口，防止长会话撑爆 context
function trimHistory() {
  if (chatMessages.length > MAX_HISTORY) {
    chatMessages.splice(0, chatMessages.length - MAX_HISTORY);
  }
  saveChatHistory();
}

// ===== 初始化聊天（杂志风 AI 屏） =====
export function initChat() {
  const $btnSendChat = $('btn-send-chat');
  const $chatInput = $('chat-input');
  const $clear = $('chatClearBtn');

  if ($btnSendChat) $btnSendChat.addEventListener('click', sendChat);

  // 滚动跟随 + 「回到底部」浮钮（滚动容器是 .app）
  const scroller = getChatScroller();
  if (scroller) scroller.addEventListener('scroll', updateToBottomBtn, { passive: true });
  const $toBottom = $('chatToBottom');
  if ($toBottom) $toBottom.addEventListener('click', () => scrollChatToBottom());

  if ($chatInput) {
    $chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    // 自动撑高
    $chatInput.addEventListener('input', () => {
      $chatInput.style.height = 'auto';
      $chatInput.style.height = Math.min($chatInput.scrollHeight, 120) + 'px';
    });
  }

  // 记忆按钮 + 弹窗
  const $mem = $('chatMemoryBtn');
  if ($mem) $mem.addEventListener('click', openMemoryModal);
  const $openTemplate = $('openTemplateBtn');
  if ($openTemplate) $openTemplate.addEventListener('click', openTemplateModal);
  const $saveTemplate = $('saveTemplateBtn');
  if ($saveTemplate) $saveTemplate.addEventListener('click', saveTemplateForm);
  const $generateTemplate = $('generateTemplateBtn');
  if ($generateTemplate) $generateTemplate.addEventListener('click', generateTemplateWithAI);
  const $clearMem = $('clearMemoryBtn');
  if ($clearMem) $clearMem.addEventListener('click', () => {
    ensureMemoryLoaded();
    memory = emptyMemory();
    try { localStorage.removeItem(memKey(logBookId)); } catch {}
    updateMemoryBadge();
    renderMemoryList();
    import('./utils.js').then(m => m.showToast('已清空本书记忆', 'success'));
  });
  // 启动时加载当前书的记忆
  loadMemory(currentBookId);
  logBookId = currentBookId;
  updateMemoryBadge();
  // 启动时恢复当前书的对话历史（刷新/重开后继续）
  loadChatHistory(currentBookId);
  renderChatHistory();

  if ($clear) {
    $clear.addEventListener('click', () => {
      chatMessages.length = 0;
      saveChatHistory();
      const c = $('chat-messages');
      if (c) c.innerHTML = WELCOME_HTML;
      applyChatVisibleLimit();
      import('./utils.js').then(m => m.showToast('已清空对话', 'success'));
    });
  }

  const $commitDraft = $('commitSmartDraftBtn');
  if ($commitDraft) $commitDraft.addEventListener('click', commitActiveSmartDraft);
  const $cancelDraft = $('cancelSmartDraftBtn');
  if ($cancelDraft) $cancelDraft.addEventListener('click', discardActiveSmartDraft);
  const $draftModal = $('smartDraftModal');
  if ($draftModal) $draftModal.addEventListener('modal:closed', discardActiveSmartDraft);
}

// ===== 流式 SSE 解析 =====
async function* streamSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try { yield JSON.parse(data); } catch {}
      }
    }
  }
}

// ===== 流式 fetch 请求 =====
async function streamFetch(apiUrl, apiKey, body) {
  // 经本地后端代理转发流式 SSE，绕开第三方网关缺 CORS 头的问题
  const resp = await fetch('/api/proxy/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: apiUrl, key: apiKey, body: { ...body, stream: true } })
  });
  if (!resp.ok) throw new Error('API ' + resp.status + ': ' + await resp.text());
  return resp;
}

// ===== 流式显示文本 =====
async function streamDisplay(response, msgEl) {
  let content = '';
  let reasoning = '';
  let toolCalls = [];
  for await (const chunk of streamSSE(response)) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    const reasoningDelta = extractReasoningDelta(delta);
    if (reasoningDelta) {
      reasoning += reasoningDelta;
      renderAssistantStream(msgEl, content, reasoning, true);
      if (isChatNearBottom()) scrollChatToBottom();
    }
    if (delta.content) {
      content += delta.content;
      renderAssistantStream(msgEl, content, reasoning, true);
      if (isChatNearBottom()) scrollChatToBottom(); // 贴底才跟随；用户上翻则不打扰
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }
  }
  collapseReasoningAfterStream(msgEl, reasoning);
  // 压实：某些代理(Anthropic→OpenAI)用 content block index 当 tool_calls index，
  // 文本块占 0 导致数组出现空洞，filter 去掉空洞并丢弃没拿到函数名的残块
  const compact = toolCalls.filter(tc => tc && tc.function && tc.function.name);
  return { content, reasoning, tool_calls: compact.length > 0 ? compact : null };
}

function collapseReasoningAfterStream(msgEl, reasoning) {
  if (!shouldCollapseReasoningAfterStream(reasoning)) return;
  const box = msgEl.querySelector('.reasoning-box');
  if (box) box.open = false;
}

function renderAssistantStream(msgEl, content, reasoning, reasoningOpen = false) {
  const parts = [];
  if (reasoning) {
    parts.push('<details class="reasoning-box"' + (reasoningDetailsShouldBeOpen(reasoning, reasoningOpen) ? ' open' : '') + '>' +
      '<summary>思考</summary>' +
      '<div class="reasoning-text">' + formatChatText(reasoning) + '</div>' +
      '</details>');
  }
  if (content) parts.push(formatChatText(content));
  else if (!reasoning) parts.push('<span class="typing-cursor">◊</span>');
  msgEl.innerHTML = parts.join('');
}

// ===== 格式化聊天文本（简单 markdown） =====
function mdInline(s) {
  // 已是转义后的文本，处理行内 markdown
  s = s.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s;
}

function formatChatText(text) {
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

// ===== 聊天滚动 =====
// 真正的滚动容器是 .app（chat 屏幕本身没有独立滚动条），
// 所以不能再对 #chat-messages 设 scrollTop，否则不生效（回复不跟随到底的根因）。
function getChatScroller() {
  return document.querySelector('.app') || document.scrollingElement || document.documentElement;
}
function isChatNearBottom(threshold = 140) {
  const s = getChatScroller();
  if (!s) return true;
  return s.scrollHeight - s.scrollTop - s.clientHeight <= threshold;
}
function scrollChatToBottom() {
  const s = getChatScroller();
  if (s) s.scrollTop = s.scrollHeight;
  updateToBottomBtn();
}

export function applyChatVisibleLimit() {
  const container = $('chat-messages');
  if (!container) return;
  const items = Array.from(container.children).filter(el => !el.classList.contains('chat-welcome'));
  applyVisibleLimitToChildren(items, readChatVisibleLimit());
}
// 离底较远且正处于 chat 屏幕时，显示「回到底部」浮钮
function updateToBottomBtn() {
  const btn = $('chatToBottom');
  if (!btn) return;
  const onChat = document.getElementById('screen-chat')?.classList.contains('active');
  btn.hidden = !onChat || isChatNearBottom();
}

// ===== 创建 AI 消息占位 =====
function createAssistantBubble() {
  const container = $('chat-messages');
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-assistant';
  div.innerHTML = '<div class="chat-msg-role">AI</div><div class="chat-msg-text"><span class="typing-cursor">◊</span></div>';
  container.appendChild(div);
  applyChatVisibleLimit();
  scrollChatToBottom(); // 新回复开始：强制滚到最后一条
  return div.querySelector('.chat-msg-text');
}

// ===== 发送按钮忙碌态 =====
let isSending = false;
function setSendBusy(busy) {
  isSending = busy;
  const btn = $('btn-send-chat');
  if (btn) {
    btn.classList.toggle('is-busy', busy);
    btn.disabled = busy;
    btn.setAttribute('aria-label', busy ? '发送中…' : '发送');
  }
  const input = $('chat-input');
  if (input) input.classList.toggle('sending', busy);
}

// ===== sendChat =====
async function sendChat() {
  if (isSending) return; // 防止重复发送
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto'; // 复位自动高度

  const apiUrl = localStorage.getItem('wbe-api-url');
  const apiKey = localStorage.getItem('wbe-api-key');
  const model = localStorage.getItem('wbe-model') || 'gpt-4o';
  const systemPrompt = localStorage.getItem('wbe-system-prompt') || DEFAULT_SYSTEM_PROMPT;

  if (!apiUrl || !apiKey) {
    import('./utils.js').then(m => m.showToast('请先在设置中配置 API 地址和 Key', 'error'));
    return;
  }

  // 换世界书时切换到对应书的记忆（不同书的记忆互不相关，持久化各存各的）
  if (currentBookId !== logBookId) { loadMemory(currentBookId); loadChatHistory(currentBookId); renderChatHistory(); logBookId = currentBookId; }

  appendChatMessage('user', text);
  chatMessages.push({ role: 'user', content: text });
  trimHistory();

  const curBookName = ($('file-name') && $('file-name').textContent) || '未命名';
  let systemMsg = systemPrompt + '\n\n当前世界书:「' + curBookName + '」，共 ' + entries.length + ' 个条目。如需多步操作（如先搜索再修改），可以连续调用工具，系统会把每步结果返回给你。你也可以用 list_books / switch_book / create_book / rename_book / get_book_info 管理整本世界书。';
  systemMsg += buildMemoryInjection();
  const messages = [
    { role: 'system', content: systemMsg },
    ...chatMessages
  ];

  const MAX_ROUNDS = 25;
  // 本回合内 AI 调用了哪些工具及结果摘要，用于生成自然语言记忆。
  const turnTrace = [];
  setSendBusy(true);
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await streamFetch(apiUrl, apiKey, { model, messages, tools: getTools(), tool_choice: 'auto' });
      const msgEl = createAssistantBubble();
      const result = await streamDisplay(resp, msgEl);

      const textToolCalls = parseTextToolCalls(result.content || '');
      console.log('[WBE] round', round, 'tool_calls:', result.tool_calls, 'textToolCalls:', textToolCalls.length);

      if (result.tool_calls && result.tool_calls.length > 0) {
        // ---- 原生 function calling ----
        const aiText = stripToolCalls(result.content || '');
        if (aiText) renderAssistantStream(msgEl, aiText, result.reasoning, false);
        else if (!hasVisibleAssistantStream(result.content, result.reasoning)) msgEl.parentElement.remove();

        messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.tool_calls });
        for (const tc of result.tool_calls) {
          let args;
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            try { args = JSON.parse((tc.function.arguments || '').replace(/\s*}\s*$/, '}')); }
            catch { args = {}; }
          }
          const r = await executeTool(tc.function.name, args);
          turnTrace.push(tc.function.name + ': ' + r.summary);
          appendChatMessage('tool', tc.function.name + ': ' + r.summary);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: r.detail });
        }
        continue; // 回到循环，AI 可继续调用工具或给出最终回复

      } else if (textToolCalls.length > 0) {
        // ---- 文本工具调用 fallback ----
        const aiText = stripToolCalls(result.content || '');
        if (aiText) renderAssistantStream(msgEl, aiText, result.reasoning, false);
        else if (!hasVisibleAssistantStream(result.content, result.reasoning)) msgEl.parentElement.remove();

        let toolResultsText = [];
        for (const tc of textToolCalls) {
          const r = await executeTool(tc.name, tc.args);
          turnTrace.push(tc.name + ': ' + r.summary);
          appendChatMessage('tool', tc.name + ': ' + r.summary);
          toolResultsText.push(tc.name + ' 结果: ' + r.summary + '\n' + r.detail);
        }

        messages.push({ role: 'assistant', content: aiText || result.content || '' });
        messages.push({ role: 'user', content: '工具执行结果:\n' + toolResultsText.join('\n\n') + '\n\n如需更多操作可继续调用工具，否则直接回复用户。' });
        continue;

      } else {
        // ---- 最终回复 ----
        const clean = stripToolCalls(result.content) || '(无回复)';
        if (clean !== result.content) renderAssistantStream(msgEl, clean, result.reasoning, false);
        chatMessages.push({ role: 'assistant', content: clean });
        trimHistory();
        // 分层记忆：记一条回合小总结，满阈值则后台整合大总结（不阻塞）
        pushTurnMemory({ user: text, trace: turnTrace, reply: clean });
        maybeRollup();
        return;
      }
    }
    // 达到轮数上限也要把已发生的过程存进历史，否则这一整轮全丢
    chatMessages.push({ role: 'assistant', content: '(本回合操作较多未给出总结)' });
    trimHistory();
    pushTurnMemory({ user: text, trace: turnTrace, reply: '(本回合操作较多未给出总结)' });
    maybeRollup();
    appendChatMessage('error', '已达最大工具调用轮数(' + MAX_ROUNDS + ')，已停止。');
  } catch (e) {
    appendChatMessage('error', '请求失败: ' + e.message);
  } finally {
    setSendBusy(false);
  }
}

function appendChatMessage(role, text) {
  const container = $('chat-messages');
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // 工具调用：连续的折叠进同一个分组，避免一堆调用刷屏
  if (role === 'tool') { appendToolLine(container, text); return; }

  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-' + role;
  div.innerHTML = '<div class="chat-msg-role">' + ({user:'你',assistant:'AI',tool:'工具',error:'错误'}[role]||role) + '</div>' +
    '<div class="chat-msg-text">' + escHtml(text) + '</div>';
  container.appendChild(div);
  applyChatVisibleLimit();
  // 自己发的消息和错误强制滚底；其余贴底才跟随
  if (role === 'user' || role === 'error' || isChatNearBottom()) scrollChatToBottom();
}

// 把连续的工具调用收进一个可展开分组（默认收起）
function appendToolLine(container, text) {
  let group = container.lastElementChild;
  if (!group || !group.classList.contains('tool-group')) {
    group = document.createElement('details');
    group.className = 'tool-group';
    group.innerHTML =
      '<summary class="tool-sum">' +
        '<span class="tool-ico">⚙</span>' +
        '<span class="tool-sum-label">工具调用</span>' +
        '<span class="tool-count">0</span>' +
        '<span class="tool-latest"></span>' +
      '</summary><div class="tool-lines"></div>';
    container.appendChild(group);
  }
  const lines = group.querySelector('.tool-lines');
  const sep = text.indexOf(': ');
  const name = sep > 0 ? text.slice(0, sep) : text;
  const summary = sep > 0 ? text.slice(sep + 2) : '';
  const line = document.createElement('div');
  line.className = 'tool-line';
  line.innerHTML = '<span class="tool-line-name">' + escHtml(name) + '</span>' +
    (summary ? '<span class="tool-line-sum">' + escHtml(summary) + '</span>' : '');
  lines.appendChild(line);
  group.querySelector('.tool-count').textContent = lines.children.length;
  group.querySelector('.tool-latest').textContent = summary || name;
  applyChatVisibleLimit();
  if (isChatNearBottom()) scrollChatToBottom();
}

// ===== AI 工具定义 =====
function getTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'search_entries',
        description: '搜索世界书条目。返回匹配的条目列表。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词（匹配标题、关键词、内容）' },
            filter: { type: 'string', enum: ['all','constant','keyword','disabled'], description: '筛选类型' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_entry',
        description: '获取指定 UID 的条目完整信息',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit_entry',
        description: '整字段覆盖式修改条目：传入的每个字段会被整体替换为新值（只传要改的字段）。适合换标题、整体重写某字段、改 enabled/position 等。若只是改长正文里的个别词句，请改用 replace_text 做查找替换，不要用本工具整段重写。',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' },
            fields: { type: 'object', description: '要修改的字段键值对' }
          },
          required: ['uid', 'fields']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_entry',
        description: '新建一个基础条目。若用户要你按人物/地点/组织/规则等类型写世界书，优先使用 create_smart_entry。',
        parameters: {
          type: 'object',
          properties: {
            comment: { type: 'string', description: '标题' },
            content: { type: 'string', description: '内容' },
            key: { type: 'array', items: { type: 'string' }, description: '触发关键词' },
            constant: { type: 'boolean', description: '是否常驻激活，默认 false' },
            semanticType: { type: 'string', description: '可选：人物/地点/组织/规则等语义类型' },
            functionType: { type: 'string', description: '可选：关键词触发/常驻背景等功能类型' }
          },
          required: ['content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_writing_template',
        description: '读取当前世界书的写作模板。创建智能条目前可调用它参考本书偏好的正文结构、段落和禁忌。',
        parameters: {
          type: 'object',
          properties: {
            semanticType: { type: 'string', enum: ['character','location','organization','faction','event','rule','item','concept','relationship','style'], description: '可选：条目语义类型，用于筛选人物/地点/组织/规则模板' },
            functionType: { type: 'string', enum: ['keyword_trigger','constant_background','recursive_detail','voice_constraint','plot_hook','hidden_fact','conflict_fix'], description: '可选：条目功能类型，用于附加剧情钩子等模板' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_writing_template',
        description: '修改当前世界书的 AI 写作占位模板。用于用户要求微调模板时，例如“把地点模板写得更细”“给剧情钩子模板增加触发条件”。只传需要修改的标签；mode=append 表示追加，默认 replace 表示替换对应标签。不要用它写正式世界书条目正文。',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['replace','append'], description: 'replace 替换指定标签；append 追加到指定标签末尾。默认 replace。' },
            general: { type: 'string', description: '通用占位模板，如“世界观核心：根据用户输入描述当前世界观，约150字”。' },
            character: { type: 'string', description: '人物占位模板。' },
            location: { type: 'string', description: '地点占位模板。' },
            organization: { type: 'string', description: '组织占位模板。' },
            rule: { type: 'string', description: '规则占位模板。' },
            plot_hook: { type: 'string', description: '剧情钩子占位模板。' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'plan_smart_entry',
        description: '生成智能世界书条目草稿并打开预览弹窗，不写入世界书。复杂条目、递归条目、剧情钩子、隐藏设定优先用这个工具，让用户确认后再创建。参数与 create_smart_entry 相同。',
        parameters: smartEntryParameters()
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_smart_entry',
        description: '直接创建智能世界书条目并写入数据库。除非用户明确要求直接创建，否则复杂条目优先使用 plan_smart_entry 让用户预览确认。',
        parameters: smartEntryParameters()
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_entries',
        description: '批量新建多个条目，一次传入一个数组。比逐条 add_entry 高效。',
        parameters: {
          type: 'object',
          properties: {
            entries: {
              type: 'array',
              description: '要新建的条目数组',
              items: {
                type: 'object',
                properties: {
                  comment: { type: 'string', description: '标题' },
                  content: { type: 'string', description: '内容' },
                  key: { type: 'array', items: { type: 'string' }, description: '触发关键词' },
                  constant: { type: 'boolean', description: '是否常驻激活，默认 false' }
                },
                required: ['content']
              }
            }
          },
          required: ['entries']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_entry',
        description: '删除指定 UID 的条目',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_entries',
        description: '批量删除条目。二选一：传 uids 数组按 UID 删，或传 filter 按条件删。',
        parameters: {
          type: 'object',
          properties: {
            uids: { type: 'array', items: { type: 'number' }, description: '要删除的 UID 列表' },
            filter: { type: 'object', description: '筛选条件：constant(bool)、disable(bool)、uid_range([min,max])、query(关键词，匹配标题/关键词/内容)' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'batch_edit',
        description: '批量修改条目。按条件筛选后统一更新字段。',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'object', description: '筛选条件：可含 constant(bool)、disable(bool)、uid_range([min,max])、query(关键词，匹配标题/关键词/内容)' },
            fields: { type: 'object', description: '要修改的字段键值对' }
          },
          required: ['filter', 'fields']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_entries',
        description: '列出条目概览（仅 UID + 标题 + 状态，不含内容）。用于快速了解世界书全貌，比逐条搜索更省。',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'string', enum: ['all','constant','keyword','disabled'], description: '筛选类型，默认 all' },
            limit: { type: 'number', description: '最多返回多少条，默认 100' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'toggle_entry',
        description: '启用或禁用条目',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' },
            disable: { type: 'boolean', description: 'true=禁用，false=启用；不传则切换当前状态' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'reorder_entry',
        description: '修改条目的 order（插入顺序，数字越小越靠前）',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' },
            order: { type: 'number', description: '新的 order 值' }
          },
          required: ['uid', 'order']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'duplicate_entry',
        description: '复制一个已有条目，生成新 UID 的副本',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '要复制的条目 UID' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'undo_last',
        description: '撤销上一次对世界书的修改（新增/删除/编辑/批量/复制等），恢复到操作前的状态',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_book_info',
        description: '获取当前正在编辑的世界书信息：书名、ID、条目数',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_books',
        description: '列出数据库里所有世界书（ID、书名、条目数），并标出当前打开的是哪一本',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'switch_book',
        description: '切换到另一本世界书并打开它。可用 id 或 name 指定（name 支持模糊匹配）。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: '目标世界书 ID（优先）' },
            name: { type: 'string', description: '目标世界书名称（id 未提供时按名称匹配）' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_book',
        description: '新建一本空白世界书并切换过去',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '新世界书名称，默认「新世界书」' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'rename_book',
        description: '重命名世界书。不传 id 则重命名当前打开的这一本。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '新名称' },
            id: { type: 'number', description: '目标世界书 ID，省略则为当前世界书' }
          },
          required: ['name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replace_text',
        description: '在条目里做查找替换，免去整段重写。默认对全书所有条目的正文(content)替换；' +
          '可传 uid 只改一条，或传 filter 缩小范围。默认按字面匹配，可开 regex 用正则。带撤销。',
        parameters: {
          type: 'object',
          properties: {
            find: { type: 'string', description: '要查找的文本（regex=true 时为正则表达式）' },
            replace: { type: 'string', description: '替换成的文本（regex 模式下可用 $1 等捕获组），删除则传空字符串' },
            fields: { type: 'array', items: { type: 'string', enum: ['content', 'comment', 'key'] }, description: '在哪些字段替换，默认 ["content"]。key 为关键词数组。' },
            uid: { type: 'number', description: '只在该 UID 条目内替换' },
            filter: { type: 'object', description: '缩小范围：{constant:bool, disable:bool, uid_range:[min,max], query:"关键字"}，与 uid 二选一' },
            regex: { type: 'boolean', description: '是否把 find 当正则，默认 false' },
            ignore_case: { type: 'boolean', description: '是否忽略大小写，默认 false' }
          },
          required: ['find', 'replace']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'manage_keys',
        description: '增删某条目的关键词，不用整条覆盖。add/remove 为字符串数组；secondary=true 时操作次要关键词(keysecondary)。带撤销。',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '目标条目 UID' },
            add: { type: 'array', items: { type: 'string' }, description: '要新增的关键词（已存在的自动跳过）' },
            remove: { type: 'array', items: { type: 'string' }, description: '要删除的关键词' },
            secondary: { type: 'boolean', description: 'true 则操作次要关键词 keysecondary，默认操作主关键词 key' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'move_entry',
        description: '设置条目的插入位置 position（reorder_entry 只改 order 数值，这个改位置类型）。' +
          'position: 0=角色定义前, 1=角色定义后, 2=作者注释前, 3=作者注释后, 4=@深度(配合 depth)。',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '目标条目 UID' },
            position: { type: 'number', description: '位置类型 0~4，见说明' },
            depth: { type: 'number', description: '当 position=4 时的注入深度，默认 4' }
          },
          required: ['uid', 'position']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_book',
        description: '删除整本世界书（不可恢复！）。不传 id 则删当前打开的这本。安全起见必须显式传 confirm:true 才真正删除。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: '目标世界书 ID，省略则为当前打开的这本' },
            name: { type: 'string', description: '按名称指定（id 未提供时模糊匹配）' },
            confirm: { type: 'boolean', description: '必须为 true 才执行删除，否则只返回待确认提示' }
          }
        }
      }
    }
  ];
}

function smartEntryParameters() {
  return {
    type: 'object',
    properties: {
      userRequest: { type: 'string', description: '用户原始需求，用于判断条目类型与功能' },
      title: { type: 'string', description: '条目标题；不传则从 userRequest 推断' },
      semanticType: { type: 'string', enum: ['character','location','organization','faction','event','rule','item','concept','relationship','style'], description: '语义类型，不确定可不传' },
      customType: { type: 'string', description: 'AI 自定义分类，如“地下据点”“宫廷传闻”“禁术代价”“边境黑市”等' },
      functionType: { type: 'string', enum: ['keyword_trigger','constant_background','recursive_detail','voice_constraint','plot_hook','hidden_fact','conflict_fix'], description: '功能类型，不确定可不传' },
      classificationReason: { type: 'string', description: '简短说明为什么这样分类。展示给用户作为可审计理由，不要写隐藏思维链。' },
      templateSections: { type: 'array', items: { type: 'string' }, description: '自定义模板段落标题，如“入口伪装”“内部气味与陈设”“交易规则”“隐藏风险”。只给标题不等于写正文；正文必须放在 content。' },
      fieldHints: {
        type: 'object',
        description: '字段设置建议，可覆盖矩阵推荐。允许 constant/selective/position/depth/order/probability/sticky/cooldown/delay 等。'
      },
      activationMode: { type: 'string', enum: ['always','keyword','selective','recursive','manual'], description: '高层触发判断。' },
      insertionMode: { type: 'string', enum: ['lore','depth','example','author_note','outlet'], description: '高层插入位置判断。' },
      recursionRole: { type: 'string', enum: ['none','entry','bridge','terminal','isolated','delayed'], description: '递归角色。' },
      persistence: { type: 'string', enum: ['none','sticky','cooldown','delayed'], description: '时效判断。' },
      randomness: { type: 'string', enum: ['none','rare','occasional','weighted'], description: '随机性判断。' },
      priority: { type: 'string', enum: ['low','normal','high','critical'], description: '影响强度。' },
      scope: { type: 'string', enum: ['global','character','scene','plot','style','safety'], description: '作用范围。' },
      matchStrictness: { type: 'string', enum: ['loose','normal','strict','exact'], description: '匹配严格度。' },
      reason: { type: 'string', description: '设置判断理由，展示给用户。' },
      content: { type: 'string', description: '完整可写入的世界书正文草稿。使用 plan_smart_entry 时也要尽量传完整正文，不要只传框架或段落标题；工具只会在缺正文时做兜底补全。' },
      key: { type: 'array', items: { type: 'string' }, description: '指定触发关键词；不传则按标题/类型推断' },
      constant: { type: 'boolean', description: '强制常驻设置；不传则按矩阵推荐' }
    },
    required: ['userRequest', 'content']
  };
}

// ===== 检测文本是否包含工具调用 =====
function hasToolCall(text) {
  if (!text) return false;
  if (/<tool_call>/.test(text)) return true;
  if (/<tool_use>/.test(text)) return true;
  if (/<function=/.test(text)) return true;
  return false;
}

// ===== 解析文本格式工具调用 =====
function parseTextToolCalls(text) {
  if (!text) return [];
  const results = [];
  let m;

  // 1. <tool_use>{"name":"xxx","arguments":{...}}</tool_use>
  const toolUseRe = /<tool_use>\s*(\{[\s\S]*?\})\s*<\/tool_use>/g;
  while ((m = toolUseRe.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj.name && TOOL_NAMES.includes(obj.name)) results.push({ name: obj.name, args: obj.arguments || {} });
    } catch (e) {}
  }
  if (results.length > 0) return results;

  // 2. <tool_call><function=xxx><parameter=xxx>yyy</parameter></function></tool_call>
  const xmlRe = /<tool_call>[\s\S]*?<function=(\w+)>[\s\S]*?<parameter=[^>]*>([\s\S]*?)<\/parameter>[\s\S]*?<\/function>[\s\S]*?<\/tool_call>/g;
  while ((m = xmlRe.exec(text)) !== null) {
    try {
      const name = m[1];
      const raw = m[2].trim();
      let args;
      try { args = JSON.parse(raw); } catch { args = { query: raw }; }
      if (typeof args !== 'object' || args === null) args = { query: raw };
      results.push({ name, args });
    } catch (e) {}
  }
  if (results.length > 0) return results;

  // 2b. 单参数 <function=xxx><parameter=name>value</parameter></function> (无 tool_call 包裹)
  const fnTagRe = /<function=(\w+)>([\s\S]*?)<\/function>/g;
  while ((m = fnTagRe.exec(text)) !== null) {
    const name = m[1];
    if (!TOOL_NAMES.includes(name)) continue;
    const body = m[2];
    const args = {};
    const paramRe = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
    let pm;
    while ((pm = paramRe.exec(body)) !== null) {
      const key = pm[1].trim();
      let val = pm[2].trim();
      if (/^-?\d+$/.test(val)) val = parseInt(val);
      else if (val === 'true') val = true;
      else if (val === 'false') val = false;
      args[key] = val;
    }
    results.push({ name, args });
  }
  if (results.length > 0) return results;

  // 3. {"name":"xxx","arguments":{...}} 独立 JSON
  const jsonRe = /\{\s*"name"\s*:\s*"(search_entries|get_entry|edit_entry|add_entry|add_entries|get_writing_template|update_writing_template|plan_smart_entry|create_smart_entry|delete_entry|delete_entries|batch_edit|replace_text|manage_keys|move_entry|list_entries|toggle_entry|reorder_entry|duplicate_entry|undo_last|get_book_info|list_books|switch_book|create_book|rename_book|delete_book)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/g;
  while ((m = jsonRe.exec(text)) !== null) {
    try { results.push({ name: m[1], args: JSON.parse(m[2]) }); } catch (e) {}
  }
  if (results.length > 0) return results;

  // 4. search_entries("xxx") 函数调用格式
  const fnRe = /\b(search_entries|get_entry|edit_entry|add_entry|add_entries|get_writing_template|update_writing_template|plan_smart_entry|create_smart_entry|delete_entry|delete_entries|batch_edit|replace_text|manage_keys|move_entry|list_entries|toggle_entry|reorder_entry|duplicate_entry|undo_last|get_book_info|list_books|switch_book|create_book|rename_book|delete_book)\s*\(([^)]*)\)/g;
  while ((m = fnRe.exec(text)) !== null) {
    try {
      const args = JSON.parse('[' + m[2] + ']');
      results.push({ name: m[1], args: typeof args[0] === 'object' ? args[0] : { query: String(args[0]) } });
    } catch {
      results.push({ name: m[1], args: { query: m[2].replace(/['"]/g, '').trim() } });
    }
  }
  return results;
}

// ===== 清理消息中的工具调用标记 =====
function stripToolCalls(text) {
  if (!text) return text;
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  text = text.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '');
  text = text.replace(/<function=\w+>[\s\S]*?<\/function>/g, '');
  text = text.replace(/\{\s*"name"\s*:\s*"(search_entries|get_entry|edit_entry|add_entry|add_entries|get_writing_template|update_writing_template|plan_smart_entry|create_smart_entry|delete_entry|delete_entries|batch_edit|replace_text|manage_keys|move_entry|list_entries|toggle_entry|reorder_entry|duplicate_entry|undo_last|get_book_info|list_books|switch_book|create_book|rename_book|delete_book)"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

async function executeTool(name, args) {
  console.log('[WBE] executeTool:', name, JSON.stringify(args).substring(0, 100));
  switch (name) {
    case 'search_entries': return toolSearch(args);
    case 'get_entry': return toolGet(args);
    case 'edit_entry': return toolEdit(args);
    case 'add_entry': return toolAdd(args);
    case 'add_entries': return toolAddMany(args || {});
    case 'get_writing_template': return toolGetWritingTemplate(args || {});
    case 'update_writing_template': return toolUpdateWritingTemplate(args || {});
    case 'plan_smart_entry': return toolPlanSmartEntry(args || {});
    case 'create_smart_entry': return toolCreateSmartEntry(args || {});
    case 'delete_entry': return toolDelete(args);
    case 'delete_entries': return toolDeleteMany(args || {});
    case 'batch_edit': return toolBatchEdit(args);
    case 'replace_text': return toolReplaceText(args || {});
    case 'manage_keys': return toolManageKeys(args || {});
    case 'move_entry': return toolMoveEntry(args || {});
    case 'list_entries': return toolList(args || {});
    case 'toggle_entry': return toolToggle(args);
    case 'reorder_entry': return toolReorder(args);
    case 'duplicate_entry': return toolDuplicate(args);
    case 'undo_last': return toolUndo();
    case 'get_book_info': return toolBookInfo();
    case 'list_books': return await toolListBooks();
    case 'switch_book': return await toolSwitchBook(args || {});
    case 'create_book': return await toolCreateBook(args || {});
    case 'rename_book': return await toolRenameBook(args || {});
    case 'delete_book': return await toolDeleteBook(args || {});
    default: return { summary: '未知工具', detail: 'Unknown tool: ' + name };
  }
}

// 统一取全部条目
function getAllEntries() {
  const wb = worldBook || window._wbe_worldBook;
  return wb && wb.entries ? Object.values(wb.entries) : (Array.isArray(entries) ? entries : []);
}

function toolSearch({ query, filter }) {
  let list = getAllEntries();
  if (filter === 'constant') list = list.filter(e => e.constant && !e.disable);
  else if (filter === 'keyword') list = list.filter(e => !e.constant && !e.disable);
  else if (filter === 'disabled') list = list.filter(e => e.disable);
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(e =>
      (e.comment||'').toLowerCase().includes(q) ||
      (e.key||[]).some(k => k.toLowerCase().includes(q)) ||
      (e.content||'').toLowerCase().includes(q)
    );
  }
  const summary = '找到 ' + list.length + ' 条';
  const shown = list.slice(0, 20);
  let detail = shown.map(e => '#' + e.uid + ' ' + (e.comment||'')).join('\n');
  if (list.length > shown.length) detail += '\n... 还有 ' + (list.length - shown.length) + ' 条未显示，可缩小关键词或用 list_entries 查看';
  return { summary, detail };
}

function toolGet({ uid }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  return { summary: '#' + uid + ' ' + (e.comment||''), detail: JSON.stringify(e, null, 2) };
}

function toolEdit({ uid, fields }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  snapshotForUndo('编辑 #' + uid);
  const changed = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'uid') continue;
    e[k] = v;
    changed.push(k);
  }
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  return { summary: '已修改 #' + uid + ' 的 ' + changed.join(','), detail: '修改字段: ' + changed.join(', ') };
}

function applyEntryMeta(entry, semanticType, functionType, extra) {
  if (!semanticType && !functionType && !extra) return;
  entry.extensions = entry.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
  entry.extensions.wbe = entry.extensions.wbe && typeof entry.extensions.wbe === 'object' ? entry.extensions.wbe : {};
  if (semanticType) entry.extensions.wbe.semanticType = semanticType;
  if (functionType) entry.extensions.wbe.functionType = functionType;
  if (extra && typeof extra === 'object') Object.assign(entry.extensions.wbe, extra);
}

function applyEntryFields(entry, fields) {
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === 'uid' || v === undefined) continue;
    entry[k] = v;
  }
}

function toolAdd({ comment, content, key, constant, semanticType, functionType }) {
  snapshotForUndo('新增条目');
  const uid = nextUid();
  const entry = createEntry(uid);
  if (comment) entry.comment = comment;
  if (content) entry.content = content;
  if (key) entry.key = key;
  if (constant) entry.constant = constant;
  applyEntryMeta(entry, semanticType, functionType);
  worldBook.entries[uidKey(uid)] = entry;
  entries.push(entry);
  renderSidebar();
  scheduleSave();
  return { summary: '已创建 #' + uid, detail: '新条目 UID: ' + uid };
}

function toolAddMany({ entries: items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { summary: '未提供条目', detail: 'entries 需为非空数组' };
  }
  snapshotForUndo('批量新增 ' + items.length + ' 条');
  const created = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const uid = nextUid();
    const entry = createEntry(uid);
    if (it.comment) entry.comment = it.comment;
    if (it.content) entry.content = it.content;
    if (it.key) entry.key = it.key;
    if (it.constant) entry.constant = it.constant;
    applyEntryMeta(entry, it.semanticType, it.functionType);
    worldBook.entries[uidKey(uid)] = entry;
    entries.push(entry);
    created.push(uid);
  }
  renderSidebar();
  scheduleSave();
  const uidStr = created.length > 8 ? created.slice(0, 8).join(',') + '…' : created.join(',');
  return { summary: '已新增 ' + created.length + ' 条 (UID ' + uidStr + ')', detail: '新条目 UID: ' + created.join(', ') };
}

function toolCreateSmartEntry(args) {
  const draft = planWorldbookEntry(withWritingTemplate(args));
  return commitSmartDraft(draft);
}

function toolPlanSmartEntry(args) {
  const draft = planWorldbookEntry(withWritingTemplate(args));
  const record = createSmartDraftRecord(draft);
  setActiveSmartDraft(smartDraftState, record);
  renderSmartDraftModal(record);
  const detail = smartDraftDetail(draft, null);
  return { summary: '已生成智能条目预览「' + draft.title + '」', detail: detail + '\n\n草稿 ID: ' + record.id + '\n请在弹窗中确认创建或取消。' };
}

function toolGetWritingTemplate(args) {
  const template = loadWritingTemplate(localStorage, currentBookId);
  const text = formatWritingTemplateForTool(template, args || {});
  return { summary: text.startsWith('当前世界书还没有') ? '本书未配置写作模板' : '已读取本书写作模板', detail: text };
}

function toolUpdateWritingTemplate(args) {
  const current = loadWritingTemplate(localStorage, currentBookId);
  const updated = applyWritingTemplateUpdate(current, args || {}, { mode: args && args.mode });
  saveWritingTemplate(localStorage, currentBookId, updated);
  if ($('templateModal') && $('templateModal').classList.contains('open')) renderTemplateForm();
  const changed = WRITING_TEMPLATE_FIELDS
    .filter(([field]) => updated[field] !== current[field])
    .map(([, label]) => label.replace('模板', ''));
  const summary = changed.length ? '已更新模板：' + changed.join('、') : '模板没有变化';
  return { summary, detail: formatWritingTemplateForTool(updated, {}) };
}

function withWritingTemplate(args) {
  const input = args || {};
  const template = loadWritingTemplate(localStorage, currentBookId);
  return {
    ...input,
    entries: getAllEntries(),
    writingTemplate: input.writingTemplate || selectWritingTemplate(template, input)
  };
}

function commitSmartDraft(draft) {
  snapshotForUndo('智能新增条目');
  const uid = nextUid();
  const entry = createEntry(uid);
  applyDraftToEntry(entry, draft);
  worldBook.entries[uidKey(uid)] = entry;
  entries.push(entry);
  renderSidebar();
  scheduleSave();
  return { summary: '已智能创建 #' + uid + '「' + draft.title + '」', detail: smartDraftDetail(draft, uid) };
}

function smartDraftDetail(draft, uid) {
  const checkText = draft.checks.map(c => '[' + c.level + '] ' + c.message).join('\n');
  const fields = draft.fields || {};
  return [
    uid != null ? 'UID: ' + uid : 'UID: (待创建)',
    '标题: ' + draft.title,
    '语义类型: ' + draft.semanticType,
    '自定义分类: ' + (draft.customType || '(无)'),
    '功能类型: ' + draft.functionType,
    '分类理由: ' + (draft.classificationReason || '按请求与默认规则判断'),
    '设置判断: ' + formatDecision(draft.decision),
    '模板段落: ' + (draft.templateSections.length ? draft.templateSections.join('、') : '内置 ' + draft.semanticType + ' 模板'),
    '设置: constant=' + fields.constant + ', position=' + fields.position + ', depth=' + fields.depth + ', order=' + fields.order,
    '关键词: ' + ((fields.key && fields.key.length) ? fields.key.join('、') : '(无)'),
    '检查:\n' + checkText,
    '正文:\n' + draft.content
  ].join('\n');
}

function renderSmartDraftModal(record) {
  const box = $('smartDraftPreview');
  const modal = $('smartDraftModal');
  if (!box || !modal) return;
  const draft = record.draft;
  const rows = draftDisplayRows(draft).map(r =>
    '<div class="draft-row"><b>' + escHtml(r.label) + '</b><span>' + escHtml(r.value) + '</span></div>'
  ).join('');
  const checks = (draft.checks || []).map(c => '[' + c.level + '] ' + c.message).join('\n') || '(无)';
  box.innerHTML = rows +
    '<div class="draft-section"><strong>风险检查</strong><pre>' + escHtml(checks) + '</pre></div>' +
    '<div class="draft-section"><strong>正文预览</strong><pre>' + escHtml(draft.content || '') + '</pre></div>';
  modal.classList.add('open');
}

function commitActiveSmartDraft() {
  const record = takeActiveSmartDraft(smartDraftState);
  if (!record) { import('./utils.js').then(m => m.showToast('没有可提交的草稿', 'error')); return; }
  const result = commitSmartDraft(record.draft);
  const modal = $('smartDraftModal');
  if (modal) modal.classList.remove('open');
  appendChatMessage('tool', result.summary);
  import('./utils.js').then(m => m.showToast(result.summary, 'success'));
}

function discardActiveSmartDraft() {
  clearActiveSmartDraft(smartDraftState);
  const modal = $('smartDraftModal');
  if (modal) modal.classList.remove('open');
  import('./utils.js').then(m => m.showToast('已取消智能条目草稿', 'success'));
}

function toolDelete({ uid }) {
  if (!worldBook.entries[uidKey(uid)]) {
    return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  }
  snapshotForUndo('删除 #' + uid);
  delete worldBook.entries[uidKey(uid)];
  const newEntries = entries.filter(e => e.uid !== uid);
  setEntries(newEntries);
  if (currentUid === uid) {
    import('./state.js').then(m => m.setCurrentUid(null));
    renderEditorEmpty();
  }
  renderSidebar();
  scheduleSave();
  return { summary: '已删除 #' + uid, detail: '已删除 UID ' + uid };
}

// 共用条目筛选：constant / disable / uid_range / query
function applyEntryFilter(list, filter) {
  if (!filter) return list;
  if (filter.constant !== undefined) list = list.filter(e => e.constant === filter.constant);
  if (filter.disable !== undefined) list = list.filter(e => e.disable === filter.disable);
  if (filter.uid_range) {
    const [min, max] = filter.uid_range;
    list = list.filter(e => e.uid >= min && e.uid <= max);
  }
  if (filter.query) {
    const q = String(filter.query).toLowerCase();
    list = list.filter(e =>
      (e.comment||'').toLowerCase().includes(q) ||
      (e.key||[]).some(k => k.toLowerCase().includes(q)) ||
      (e.content||'').toLowerCase().includes(q)
    );
  }
  return list;
}

function toolDeleteMany({ uids, filter }) {
  let targets;
  if (Array.isArray(uids) && uids.length > 0) {
    const set = new Set(uids);
    targets = getAllEntries().filter(e => set.has(e.uid));
  } else if (filter) {
    targets = applyEntryFilter(getAllEntries(), filter);
  } else {
    return { summary: '未提供条件', detail: '需提供 uids 数组或 filter 条件' };
  }
  if (targets.length === 0) return { summary: '无匹配条目', detail: '没有匹配的条目，未删除' };
  snapshotForUndo('批量删除 ' + targets.length + ' 条');
  const delUids = targets.map(e => e.uid);
  const delSet = new Set(delUids);
  for (const e of targets) delete worldBook.entries[uidKey(e.uid)];
  setEntries(entries.filter(e => !delSet.has(e.uid)));
  if (currentUid !== null && delSet.has(currentUid)) {
    import('./state.js').then(m => m.setCurrentUid(null));
    renderEditorEmpty();
  }
  renderSidebar();
  scheduleSave();
  const dStr = delUids.length > 8 ? delUids.slice(0, 8).join(',') + '…' : delUids.join(',');
  return { summary: '已删除 ' + delUids.length + ' 条 (UID ' + dStr + ')', detail: '已删除 UID: ' + delUids.join(', ') };
}

function toolBatchEdit({ filter, fields }) {
  let list = applyEntryFilter(getAllEntries(), filter);
  if (list.length === 0) return { summary: '无匹配条目', detail: '筛选条件未匹配到任何条目，未做修改' };
  snapshotForUndo('批量修改 ' + list.length + ' 条');
  const changed = Object.keys(fields);
  let count = 0;
  for (const e of list) {
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'uid') continue;
      e[k] = v;
    }
    count++;
  }
  renderSidebar();
  if (currentUid) {
    const current = entries.find(e => e.uid === currentUid);
    if (current) renderEditor(current);
  }
  scheduleSave();
  return { summary: '已批量修改 ' + count + ' 条', detail: '修改字段: ' + changed.join(', ') + '，影响 ' + count + ' 条' };
}

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 查找替换：默认全书 content，可用 uid / filter 缩小，字面或正则
function toolReplaceText({ find, replace, fields, uid, filter, regex, ignore_case }) {
  if (find == null || find === '') return { summary: 'find 不能为空', detail: '需要提供要查找的文本' };
  if (replace == null) replace = '';
  const allow = ['content', 'comment', 'key'];
  let cols = Array.isArray(fields) && fields.length ? fields.filter(f => allow.includes(f)) : ['content'];
  if (!cols.length) cols = ['content'];

  let re;
  try {
    const flags = 'g' + (ignore_case ? 'i' : '');
    re = new RegExp(regex ? find : escapeRegExp(find), flags);
  } catch (e) { return { summary: '正则无效', detail: e.message }; }

  // 选定目标条目
  let targets;
  if (uid != null) {
    const e = getAllEntries().find(x => x.uid === uid);
    if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    targets = [e];
  } else {
    targets = applyEntryFilter(getAllEntries(), filter);
  }
  if (!targets.length) return { summary: '无匹配条目', detail: '筛选条件未匹配到任何条目' };

  const countIn = (str) => { const m = String(str).match(re); return m ? m.length : 0; };
  const doRepl = (str) => regex ? str.replace(re, replace) : str.replace(re, () => replace);

  let total = 0, affected = 0;
  const pending = [];
  for (const e of targets) {
    let hit = 0;
    for (const col of cols) {
      if (col === 'key') {
        const arr = Array.isArray(e.key) ? e.key : [];
        for (const k of arr) hit += countIn(k);
      } else if (typeof e[col] === 'string') {
        hit += countIn(e[col]);
      }
    }
    if (hit > 0) { pending.push(e); total += hit; affected++; }
  }
  if (total === 0) return { summary: '未找到「' + find + '」', detail: '在 ' + targets.length + ' 条目的 ' + cols.join('/') + ' 中没有匹配' };

  snapshotForUndo('替换「' + find + '」→「' + replace + '」(' + affected + ' 条)');
  for (const e of pending) {
    for (const col of cols) {
      if (col === 'key') {
        if (Array.isArray(e.key)) e.key = e.key.map(k => doRepl(k)).filter(k => k !== '');
      } else if (typeof e[col] === 'string') {
        e[col] = doRepl(e[col]);
      }
    }
  }
  if (currentUid != null && pending.some(e => e.uid === currentUid)) {
    const cur = entries.find(e => e.uid === currentUid);
    if (cur) renderEditor(cur);
  }
  renderSidebar();
  scheduleSave();
  return {
    summary: '已替换 ' + total + ' 处，影响 ' + affected + ' 条',
    detail: '在 ' + cols.join('/') + ' 把「' + find + '」替换为「' + replace + '」' + (regex ? '（正则）' : '') + '，共 ' + total + ' 处 / ' + affected + ' 个条目'
  };
}

// 增删某条目的关键词（主 key 或次 keysecondary）
function toolManageKeys({ uid, add, remove, secondary }) {
  const e = getAllEntries().find(x => x.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const addArr = Array.isArray(add) ? add.map(s => String(s).trim()).filter(Boolean) : [];
  const rmArr = Array.isArray(remove) ? remove.map(s => String(s).trim()).filter(Boolean) : [];
  if (!addArr.length && !rmArr.length) return { summary: '无操作', detail: '需提供 add 或 remove 数组' };
  const field = secondary ? 'keysecondary' : 'key';
  const label = secondary ? '次要关键词' : '关键词';
  snapshotForUndo('调整 #' + uid + ' 的' + label);
  let arr = Array.isArray(e[field]) ? e[field].slice() : [];
  let added = 0, removed = 0;
  if (rmArr.length) {
    const rmSet = new Set(rmArr);
    const before = arr.length;
    arr = arr.filter(k => !rmSet.has(k));
    removed = before - arr.length;
  }
  for (const k of addArr) { if (!arr.includes(k)) { arr.push(k); added++; } }
  e[field] = arr;
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  return {
    summary: '#' + uid + ' ' + label + ' +' + added + ' / -' + removed,
    detail: '#' + uid + ' 当前' + label + '：' + (arr.length ? arr.join('、') : '(空)')
  };
}

// 设置条目插入位置 position（与 reorder 的 order 数值互补）
function toolMoveEntry({ uid, position, depth }) {
  const e = getAllEntries().find(x => x.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  if (typeof position !== 'number') return { summary: 'position 须为数字', detail: '收到的 position: ' + position };
  const names = { 0: '角色定义前', 1: '角色定义后', 2: '作者注释前', 3: '作者注释后', 4: '@深度' };
  snapshotForUndo('移动位置 #' + uid);
  e.position = position;
  let extra = '';
  if (position === 4 && typeof depth === 'number') { e.depth = depth; extra = '，深度 ' + depth; }
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  const posName = names[position] || ('position=' + position);
  return { summary: '#' + uid + ' 移到「' + posName + '」' + extra, detail: '#' + uid + ' position=' + position + '（' + posName + '）' + extra };
}

function toolList({ filter, limit } = {}) {
  let list = getAllEntries();
  if (filter === 'constant') list = list.filter(e => e.constant && !e.disable);
  else if (filter === 'keyword') list = list.filter(e => !e.constant && !e.disable);
  else if (filter === 'disabled') list = list.filter(e => e.disable);
  list = list.slice().sort((a, b) => a.uid - b.uid);
  const lim = limit || 100;
  const shown = list.slice(0, lim);
  let detail = shown.map(e => {
    const flag = e.disable ? '[禁]' : (e.constant ? '[常驻]' : '');
    return '#' + e.uid + ' ' + flag + ' ' + (e.comment || '(无标题)');
  }).join('\n');
  if (list.length > shown.length) detail += '\n... 还有 ' + (list.length - shown.length) + ' 条未显示（可调大 limit）';
  return { summary: '共 ' + list.length + ' 条', detail: detail || '(无条目)' };
}

function toolToggle({ uid, disable }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  snapshotForUndo((e.disable ? '启用' : '禁用') + ' #' + uid);
  e.disable = (disable === undefined || disable === null) ? !e.disable : !!disable;
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  const state = e.disable ? '已禁用' : '已启用';
  return { summary: '#' + uid + ' ' + state, detail: '#' + uid + ' (' + (e.comment||'') + ') ' + state };
}

function toolReorder({ uid, order }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  if (typeof order !== 'number') return { summary: 'order 须为数字', detail: '收到的 order: ' + order };
  snapshotForUndo('调整顺序 #' + uid);
  e.order = order;
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  return { summary: '#' + uid + ' order=' + order, detail: '#' + uid + ' (' + (e.comment||'') + ') order 已设为 ' + order };
}

function toolDuplicate({ uid }) {
  const src = getAllEntries().find(e => e.uid === uid);
  if (!src) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  snapshotForUndo('复制 #' + uid);
  const newUid = nextUid();
  const copy = JSON.parse(JSON.stringify(src));
  copy.uid = newUid;
  copy.comment = (src.comment || '') + ' (副本)';
  worldBook.entries[uidKey(newUid)] = copy;
  entries.push(copy);
  renderSidebar();
  scheduleSave();
  return { summary: '已复制 #' + uid + ' → #' + newUid, detail: '新副本 UID: ' + newUid + '（标题: ' + copy.comment + '）' };
}

function toolUndo() {
  const label = restoreUndo();
  if (!label) return { summary: '无可撤销操作', detail: '撤销栈为空，没有可恢复的修改' };
  renderSidebar();
  if (currentUid) {
    const e = entries.find(x => x.uid === currentUid);
    if (e) renderEditor(e);
    else { import('./state.js').then(m => m.setCurrentUid(null)); renderEditorEmpty(); }
  }
  scheduleSave();
  return { summary: '已撤销「' + label + '」', detail: '已恢复到「' + label + '」操作之前的状态' };
}

// ===== 世界书级工具 =====
function currentBookName() {
  const el = $('file-name');
  return (el && el.textContent) || '未命名';
}

function toolBookInfo() {
  const name = currentBookName();
  return {
    summary: '当前「' + name + '」，' + entries.length + ' 条',
    detail: '书名: ' + name + '\nID: ' + (currentBookId != null ? currentBookId : '未知') + '\n条目数: ' + entries.length
  };
}

async function toolListBooks() {
  const books = await loadBookList();
  if (!books.length) return { summary: '暂无世界书', detail: '数据库里没有世界书' };
  const detail = books.map(b => {
    const cur = b.id === currentBookId ? '  ← 当前' : '';
    return '#' + b.id + ' ' + b.name + '（' + b.entry_count + ' 条）' + cur;
  }).join('\n');
  return { summary: '共 ' + books.length + ' 本世界书', detail };
}

async function toolSwitchBook({ id, name }) {
  const books = await loadBookList();
  let target = null;
  if (id != null) target = books.find(b => b.id === id);
  if (!target && name) {
    const q = String(name).toLowerCase();
    target = books.find(b => b.name.toLowerCase() === q) || books.find(b => b.name.toLowerCase().includes(q));
  }
  if (!target) return { summary: '未找到目标世界书', detail: '没有匹配 id=' + id + ' / name=' + name + ' 的世界书。可先用 list_books 查看。' };
  if (target.id === currentBookId) return { summary: '已在「' + target.name + '」', detail: '当前已是该世界书，无需切换' };
  await loadBook(target.id, renderSidebar, selectEntry, renderEditorEmpty);
  return { summary: '已切换到「' + target.name + '」', detail: '已打开世界书 #' + target.id + '（' + target.name + '），现有 ' + entries.length + ' 条' };
}

async function toolCreateBook({ name }) {
  const bookName = (name && String(name).trim()) || '新世界书';
  const res = await createBook(bookName);
  await loadBook(res.id, renderSidebar, selectEntry, renderEditorEmpty);
  return { summary: '已创建并打开「' + bookName + '」', detail: '新世界书 #' + res.id + '（' + bookName + '）已创建并切换过去' };
}

async function toolRenameBook({ name, id }) {
  const newName = name && String(name).trim();
  if (!newName) return { summary: '缺少新名称', detail: '请提供 name 参数' };
  const targetId = (id != null) ? id : currentBookId;
  if (targetId == null) return { summary: '无目标世界书', detail: '当前没有打开的世界书，也未指定 id' };
  try {
    if (targetId === currentBookId) {
      await renameBook(targetId, newName, worldBook);
      const el = $('file-name');
      if (el) el.textContent = newName;
    } else {
      const book = await apiRequest('GET', '/api/books/' + targetId);
      await renameBook(targetId, newName, book.data);
    }
    return { summary: '已重命名为「' + newName + '」', detail: '世界书 #' + targetId + ' 已重命名为「' + newName + '」' };
  } catch (e) {
    return { summary: '重命名失败', detail: e.message };
  }
}

async function toolDeleteBook({ id, name, confirm }) {
  const books = await loadBookList();
  let target = null;
  if (id != null) target = books.find(b => b.id === id);
  else if (name) {
    const q = String(name).toLowerCase();
    target = books.find(b => b.name.toLowerCase() === q) || books.find(b => b.name.toLowerCase().includes(q));
  } else if (currentBookId != null) target = books.find(b => b.id === currentBookId);
  if (!target) return { summary: '未找到目标世界书', detail: '没有匹配 id=' + id + ' / name=' + name + ' 的世界书。可先用 list_books 查看。' };
  if (confirm !== true) {
    return { summary: '需确认删除「' + target.name + '」', detail: '将永久删除世界书 #' + target.id + '（' + target.name + '），不可恢复。确认请再次调用 delete_book 并传 confirm:true。' };
  }
  const wasCurrent = target.id === currentBookId;
  try { await deleteBook(target.id); }
  catch (e) { return { summary: '删除失败', detail: e.message }; }

  let tail = '';
  if (wasCurrent) {
    const rest = await loadBookList();
    if (rest.length) {
      await loadBook(rest[0].id, renderSidebar, selectEntry, renderEditorEmpty);
      tail = '，已切换到「' + rest[0].name + '」';
    } else {
      const st = await import('./state.js');
      st.setCurrentBookId(null); st.setCurrentUid(null);
      setEntries([]); renderSidebar(); renderEditorEmpty();
      const el = $('file-name'); if (el) el.textContent = '未命名';
      tail = '，已无其它世界书';
    }
  }
  return { summary: '已删除「' + target.name + '」', detail: '世界书 #' + target.id + '（' + target.name + '）已永久删除' + tail };
}
