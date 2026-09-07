// ===== AI 聊天 =====
import { escHtml, escAttr, $ } from './utils.js';
import { worldBook, entries, currentUid, currentBookId, nextUid, createEntry, setEntries, snapshotForUndo, restoreUndo, undoStackLength, restoreUndoTo } from './state.js';
import { renderSidebar, selectEntry } from './sidebar.js';
import { renderEditor, renderEditorEmpty } from './editor.js';
import { scheduleSave, apiRequest, loadBookList, loadBook, createBook, renameBook, deleteBook } from './api.js';
import { summarizeToolTraceForMemory } from './memory-summary.js';
import { planWorldbookEntry } from './worldbook-intelligence/index.js';
import { TEMPLATES } from './worldbook-intelligence/templates.js';
import { extractReasoningDelta, hasVisibleAssistantStream, reasoningDetailsShouldBeOpen, shouldCollapseReasoningAfterStream } from './reasoning.js';
import { applyVisibleLimitToChildren, readChatVisibleLimit } from './chat-view.js';
import { applyDraftToEntry, createSmartDraftRecord, draftDisplayRows, formatDecision } from './smart-draft.js';
import { clearActiveSmartDraft, createSmartDraftState, setActiveSmartDraft, takeActiveSmartDraft } from './smart-draft-state.js';
import { WRITING_TEMPLATE_FIELDS, applyWritingTemplateUpdate, buildWritingTemplateGenerationMessages, formatWritingTemplateForTool, loadWritingTemplate, parseWritingTemplateDraft, saveWritingTemplate, selectWritingTemplate, writingTemplateKey } from './writing-template.js';
import { streamFetch, streamSSE } from './ai/transport.js';
import { runWorldBookCommand } from './domain/command-runtime.js';
import { CommandType } from './domain/worldbook-commands.js';
import { getTools } from './ai/tools/definitions.js';
import { countMessagesTokens, trimToBudget } from './ai/conversation/budget.js';
import { runConversationTurn } from './ai/conversation/engine.js';
import { addSessionTokens, createSession as makeSession, emptyMemory, enforceMemoryLimits, normalizeMemory, normalizeSessionList, pruneSessions, recentMemoryTurns, selectActiveSession, titleFromMessages, updateSessionFromChat, visibleMessagesFromSession } from './ai/session/model.js';
import { formatChatText } from './ai/ui/markdown.js';
import { applyEntryFilter as filterEntries, searchEntries, getEntry, listEntries, findDuplicates, checkEntries, testTriggers, bookInfo as buildBookInfo } from './ai/tools/worldbook-read.js';

// ===== 聊天状态 =====
const chatMessages = [];
let chatOpen = false;
const MAX_HISTORY = 40;

// 默认系统提示（设置框占位 + 未配置时兜底都用它）
export const DEFAULT_SYSTEM_PROMPT = '你是一个世界书编辑助手。根据用户指令调用工具完成操作：' +
  '条目级——搜索/查看/新增(单条 add_entry、多条 add_entries)/编辑/批量修改/删除(单条 delete_entry、批量 delete_entries)/启用禁用/排序/复制/撤销；' +
  '智能写作——当用户要求创建人物、地点、组织、规则、事件、物品、关系、文风等设定条目时，复杂条目优先用 plan_smart_entry 生成预览，由用户确认后写入；用户明确要求直接创建时才用 create_smart_entry。content 必须写完整正文：按「段落名：内容」逐段写完所有段落，每段要有具体可用的设定细节，严禁输出“需要写成…”“围绕…补充”“可直接进入对话上下文”等指令性占位文字。你可以根据本书气质自由给出 customType、classificationReason、templateSections 和设置判断矩阵；' +
  '世界书条目规范——条目是注入给扮演 AI 的设定片段，不是给用户看的文章：正文直接陈述设定事实，信息密度高；篇幅按设定复杂度弹性——小条目 80–300 字，主要人物/组织/规则体系等大卡可 500–1500 字甚至更长，内容完整优先，不删细节也不注水。按段落组织；关键词选书里会出现的人名/地名/物品/概念等具体词（2–6 个），不要用“他”“王城”这类过泛的词；常驻(constant)用于始终生效的规则/口吻，关键词触发用于按需注入的具体设定；内容与已有条目互补，不重复改写同一设定。参考示例：「标题：王城夜禁｜关键词：夜禁、宵禁｜正文：王城每日戌时起宵禁，城门紧闭、坊市禁火。巡夜禁军遇无令牌者先警告再擒拿，反抗者可就地处决；仅更夫、御医与持金牌者通行。」' +
  '设定集规范——世界书条目应当像动漫/小说的设定集词条：结构完整、信息分层、可考据、中立客观。正文必须覆盖四要素：人（职业/岗位/关键人物）、地（至少 2 个具体地点）、数（价格/时间/数量/比例）、则（流程/规则/代价）。类型定制要素：医疗机构→诊室/科室分布、岗位分工、诊疗流程、收费规则；法律→适用对象、条文、处罚、执行机构；地点→空间布局、出入口、常驻人员、禁区；组织→架构、资金来源、成员数量、地盘范围；人物→身份履历、外貌、性格、能力、关系、现状。缺少要素是缺陷，必须补全。' +
  '外观与衣着描写（人物、职业、成员相关条目必填）——按可观测细节写：上衣（款式、材质、颜色、领口/袖口）、下装、鞋、外搭；配饰（首饰、武器、随身物、身份标志）；体貌（发色瞳色、伤疤纹身、体态、惯用手）。全部是旁观者一眼可见的特征，供角色扮演直接调用，禁止“穿着得体”“气质优雅”等空泛词。' +
  '世界观条目组织（法律/历史/地理/经济/超凡体系/文化）——同样按设定集词条组织，用分节标题、四要素、中立可考据：法律像法条（逐条列出），历史像年表（时间线+事件+影响），地理像志书（区域+地标+物产），超凡体系像教科书（原理+等级+代价+禁忌）。' +
  '局部修改优先——改正文里的个别词用 replace_text 查找替换（不必整段重写）、增删关键词用 manage_keys、改插入位置用 move_entry；' +
  '整本世界书级——get_book_info 查当前书信息、list_books 列出所有书、switch_book 切换、create_book 新建、rename_book 重命名、delete_book 删除(需 confirm:true)。' +
  'web_search 使用规则——仅在需要现实世界资料时调用（用户要求查证历史/地理/文化/法律/科技等真实知识，或写作需要现实依据时）；世界书内部内容一律用 search_entries 查，不要联网；纯虚构创作且用户未要求查证时不要调用；单回合最多调用 5 次；结果需甄别，提炼可用信息融入设定，不要照抄原文。' +
  '需要一次写入或删除多条时优先用批量工具；改长正文的局部内容时优先 replace_text 而非 edit_entry 整段重写。回复简洁。' +
  '关键词冲突处理规则——check_entries 报告里的“[关键词共享]”不是错误：两条目共用关键词但内容不重叠时（如人物与其装备共享人名），是有意的互补设计，必须保留，不要改动。只有“[关键词冲突]”（内容高度相似）才需要处理。处理方式优先合并或调整新增的条目，禁止擅自删除/修改已有条目的关键词——那会让该条目失去触发；确需修改时先向用户说明影响并得到确认。';
const smartDraftState = createSmartDraftState();

// ===== 分层记忆：回合小总结 + AI 大总结，按世界书持久化 =====
// turns: 每回合一条小总结 {user, actionSummary, toolSummary, toolDetail[], reply, ts}
// rollups: 每满 ROLLUP_EVERY 条小总结，AI 浓缩成一段阶段总结 {from, to, text}
// rolledUpCount: 已被大总结覆盖的 turns 前缀数量
let memory = emptyMemory();
let logBookId = null;     // 当前已加载记忆的 bookId
let isRollingUp = false;  // 大总结进行中锁
const ROLLUP_EVERY = 10;  // 每满 N 条小总结整合一次

function memKey(bookId) { return 'wbe-memory:' + (bookId || 'unsaved'); }

// ===== 会话/记忆持久化：后端 SQLite（容量不受 localStorage 限制），localStorage 仅作一次性迁移源 =====
// 写操作串行入队，避免并发 PUT 互相覆盖；失败只告警不阻断（下次保存会重写全量）
let persistQueue = Promise.resolve();
function persistPut(bookId, payload) {
  persistQueue = persistQueue.then(async () => {
    try {
      const { authHeaders } = await import('./auth.js');
      await fetch('/api/ai-data/' + bookId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('[WBE] 持久化失败（book ' + bookId + '）:', e.message);
    }
  });
  return persistQueue;
}
async function persistFetch(bookId) {
  const { authHeaders } = await import('./auth.js');
  const r = await fetch('/api/ai-data/' + bookId, { headers: authHeaders() });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// 把损坏的本地数据备份到 wbe-corrupt-backup，避免坏数据被静默重置丢失
function backupCorruptData(key, raw) {
  try {
    if (raw == null) return;
    let backups = {};
    try {
      const old = JSON.parse(localStorage.getItem('wbe-corrupt-backup') || '{}');
      if (old && typeof old === 'object') backups = old;
    } catch (e) {}
    backups[key] = String(raw).slice(0, 500000); // 限制备份大小，防止备份本身撑爆存储
    localStorage.setItem('wbe-corrupt-backup', JSON.stringify(backups));
  } catch (e) {
    console.warn('[WBE] 备份损坏数据失败:', key, e);
  }
}

function saveMemory() {
  try {
    // 会话模型统一执行记忆上限规则，保持 rolledUpCount 语义。
    enforceMemoryLimits(memory);
    // 会话级记忆：写入当前会话对象，随会话一起持久化
    const cur = sessions.find(s => s.id === activeSessionId);
    if (cur) cur.memory = memory;
    persistPut(logBookId, { sessions });
  } catch (e) {
    console.warn('[WBE] 记忆保存失败:', e);
    import('./utils.js').then(m => m.showToast('记忆保存失败', 'error'));
  }
}
function recentTurns() { return recentMemoryTurns(memory); }

// ===== 对话历史持久化（按世界书保存，支持多会话并行） =====
function sessionsKey(bookId) { return 'wbe-sessions:' + (bookId || 'unsaved'); }
function activeKey(bookId) { return 'wbe-active-session:' + (bookId || 'unsaved'); }

let sessions = [];          // 当前书的会话列表
let activeSessionId = null; // 活动会话 id

// 累计本会话的发送 token（持久化在 session 对象，随 saveChatHistory 落库）
function accumulateSessionTokens() {
  const cur = sessions.find(s => s.id === activeSessionId);
  addSessionTokens(cur, lastTokensTotal);
}

async function loadChatHistory(bookId) {
  let data = null;
  try {
    data = await persistFetch(bookId);
  } catch (e) {
    console.warn('[WBE] 会话历史加载失败:', e.message);
  }
  let list = data && Array.isArray(data.sessions) ? data.sessions : null;
  let activeId = data ? data.activeSession : null;
  if (!list) {
    // 一次性迁移：localStorage 旧数据 → 上传后端后删除
    const key = sessionsKey(bookId);
    let raw = null;
    try { raw = localStorage.getItem(key); } catch {}
    let local = null;
    try { local = raw ? JSON.parse(raw) : null; } catch (e) {
      console.warn('[WBE] 会话历史数据损坏，已重置:', key, e);
      backupCorruptData(key, raw);
      import('./utils.js').then(m => m.showToast('会话历史数据损坏，已备份并重置', 'error'));
    }
    if (!Array.isArray(local)) {
      // 迁移旧版单会话历史 wbe-chat:<bookId>
      let old = [];
      try {
        const oldRaw = localStorage.getItem('wbe-chat:' + (bookId || 'unsaved'));
        if (oldRaw) old = JSON.parse(oldRaw);
      } catch (e) { console.warn('[WBE] 旧版会话历史损坏，跳过迁移:', e.message); }
      local = [];
      if (Array.isArray(old) && old.length) {
        const s = makeSession();
        s.messages = old;
        s.title = titleFromMessages(old);
        local.push(s);
      }
    }
    if (local.length) {
      list = local;
      activeId = localStorage.getItem(activeKey(bookId)) || null;
      persistPut(bookId, { sessions: list, activeSession: activeId });
    }
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(activeKey(bookId));
      localStorage.removeItem('wbe-chat:' + (bookId || 'unsaved'));
    } catch {}
  }
  sessions = normalizeSessionList(list);
  const target = selectActiveSession(sessions, activeId);
  activeSessionId = target ? target.id : null;
  chatMessages.length = 0;
  if (target) {
    chatMessages.push(...visibleMessagesFromSession(target));
    // 会话级记忆：若该会话还没有记忆，迁移旧的「书级记忆」（后端 ai_data / localStorage）到该会话
    if (!target.memory) {
      target.memory = await migrateLegacyMemory(bookId);
    }
    memory = normalizeMemory(target.memory);
  } else {
    memory = emptyMemory();
  }
  updateMemoryBadge();
}

// 旧书级记忆一次性迁移：后端 ai_data.memory 或 localStorage wbe-memory:<bookId> → 当前会话
async function migrateLegacyMemory(bookId) {
  try {
    const data = await persistFetch(bookId);
    if (data && data.memory) {
      persistPut(bookId, { memory: null }); // 迁移后清空后端书级记忆
      return normalizeMemory(data.memory);
    }
  } catch (e) { console.warn('[WBE] 书级记忆迁移(后端)失败:', e.message); }
  try {
    const key = memKey(bookId);
    const raw = localStorage.getItem(key);
    if (raw) {
      const m = JSON.parse(raw);
      localStorage.removeItem(key);
      if (m && (m.turns || m.rollups)) return normalizeMemory(m);
    }
  } catch (e) { console.warn('[WBE] 书级记忆迁移(localStorage)失败:', e.message); }
  return emptyMemory();
}

function saveChatHistory() {
  try {
    const cur = sessions.find(s => s.id === activeSessionId);
    if (cur) updateSessionFromChat(cur, chatMessages);
    // 会话数上限规则由 session model 统一维护。
    sessions = pruneSessions(sessions, activeSessionId);
    persistPut(logBookId, { sessions, activeSession: activeSessionId });
  } catch (e) {
    console.warn('[WBE] 会话历史保存失败:', e);
    import('./utils.js').then(m => m.showToast('会话保存失败', 'error'));
  }
}

// ===== 会话操作 =====
// 在途流式请求的 AbortController：切换会话/清空对话/换书时中断，
// 避免流结束后把回复写进错误的会话；也用于 120s 超时自动停止。
let activeChatAbort = null; // { controller, reason: 'switch'|'timeout'|null, sessionId }

function abortActiveChat(reason) {
  if (activeChatAbort) {
    activeChatAbort.reason = reason || 'switch';
    try { activeChatAbort.controller.abort(); } catch (e) {}
  }
}

// 快照校验：流开始时的会话/世界书仍与当前一致才允许提交结果
function turnStillActive(sessionIdAtStart, bookIdAtStart) {
  return activeSessionId === sessionIdAtStart && currentBookId === bookIdAtStart;
}

function switchSession(id) {
  abortActiveChat('switch'); // 中断在途流式回复，避免结果写进错误会话
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  activeSessionId = id;
  chatMessages.length = 0;
  for (const m of s.messages) chatMessages.push(m);
  // 记忆与会话绑定：切换时载入该会话的记忆
  memory = normalizeMemory(s.memory);
  updateMemoryBadge();
  saveChatHistory();
  renderChatHistory();
  closeSessionList();
  import('./utils.js').then(m => m.showToast('已切换到「' + (s.title || '新对话') + '」', 'success'));
}

function newSession() {
  abortActiveChat('switch');
  const s = makeSession();
  sessions.push(s);
  activeSessionId = s.id;
  chatMessages.length = 0;
  memory = emptyMemory(); // 新会话从零记忆开始
  updateMemoryBadge();
  saveChatHistory();
  renderChatHistory();
  closeSessionList();
  const inp = $('chat-input');
  if (inp) inp.focus();
}

function deleteSession(id) {
  abortActiveChat('switch');
  const idx = sessions.findIndex(x => x.id === id);
  if (idx < 0) return;
  sessions.splice(idx, 1);
  if (activeSessionId === id) {
    const next = sessions[sessions.length - 1] || sessions[0] || null;
    activeSessionId = next ? next.id : null;
    chatMessages.length = 0;
    if (next) for (const m of next.messages) chatMessages.push(m);
    memory = next ? normalizeMemory(next.memory) : emptyMemory(); // 同步到新会话记忆
    updateMemoryBadge();
  }
  saveChatHistory();
  renderChatHistory();
  renderSessionList();
}

let sessionQuery = ''; // 会话搜索词
let memoryQuery = '';  // 记忆搜索词

function renderSessionList() {
  const listEl = $('sessionList');
  if (!listEl) return;
  if (!sessions.length) {
    listEl.innerHTML = '<div class="session-empty">还没有会话，点「+ 新建会话」开一个。</div>';
    return;
  }
  const q = sessionQuery.toLowerCase();
  const shown = sessions
    .filter(s => !q || (s.title || '').toLowerCase().includes(q) || (s.messages || []).some(m => String(m.content || '').toLowerCase().includes(q)))
    .slice().sort((a, b) => b.updatedAt - a.updatedAt);
  if (!shown.length) {
    listEl.innerHTML = '<div class="session-empty">没有匹配「' + escHtml(sessionQuery) + '」的会话。</div>';
    return;
  }
  listEl.innerHTML = shown.map(s => {
    const active = s.id === activeSessionId ? ' session-item-active' : '';
    const t = new Date(s.updatedAt);
    const ts = t.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return '<div class="session-item' + active + '" data-session="' + s.id + '">' +
      '<div class="session-item-main">' +
        '<strong>' + escHtml(s.title || '新对话') + '</strong>' +
        '<small>' + s.messages.length + ' 条消息 · ' + ts + '</small>' +
      '</div>' +
      '<button class="session-del" data-del="' + s.id + '" aria-label="删除会话">✕</button>' +
    '</div>';
  }).join('');
}

function closeSessionList() { const m = $('memoryModal'); if (m) m.classList.remove('open'); }

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
  for (let i = 0; i < chatMessages.length; i++) {
    appendChatMessage(chatMessages[i].role, chatMessages[i].content, i);
  }
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
  const q = memoryQuery.toLowerCase();
  const match = s => !q || String(s || '').toLowerCase().includes(q);
  const rollups = memory.rollups.filter(r => match(r.text));
  const recentShown = recent.filter(t => match(t.user) || match(t.actionSummary) || match(t.toolSummary) || match(t.reply));
  if (!memory.rollups.length && !recent.length) {
    list.innerHTML = '<div class="memory-empty">暂无记忆。AI 在本书的每个回合会自动记录小总结，每 ' + ROLLUP_EVERY + ' 回合 AI 整合成一段阶段总结。</div>';
    return;
  }
  if (q && !rollups.length && !recentShown.length) {
    list.innerHTML = '<div class="memory-empty">没有匹配「' + escHtml(memoryQuery) + '」的记忆。</div>';
    return;
  }
  let html = '';
  if (isRollingUp) html += '<div class="memory-rolling">⟳ 正在整合阶段总结…</div>';
  if (rollups.length) {
    html += '<div class="memory-section-label">阶段总结 · DIGEST</div>';
    html += rollups.map((r, i) =>
      '<div class="memory-rollup"><span class="memory-no">§' + (i + 1) + '</span>' +
      '<div class="memory-copy"><small class="memory-range">回合 ' + (r.from + 1) + '–' + r.to + '</small>' +
      '<p>' + escHtml(r.text) + '</p></div></div>'
    ).join('');
  }
  html += '<div class="memory-section-label">近期记忆 · RECENT</div>';
  if (!recentShown.length) {
    html += '<div class="memory-empty-mini">' + (q ? '（无匹配）' : '（已全部整合进阶段总结）') + '</div>';
  } else {
    html += recentShown.map((t, i) => {
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
// 附属 AI 请求（标题生成/记忆总结/正文补全/模板生成）统一带 60s 超时，避免上游挂起卡死
const AUX_REQUEST_TIMEOUT_MS = 60000;

async function fetchCompletion(messages, opts = {}) {
  const apiUrl = opts.apiUrl || localStorage.getItem('wbe-api-url');
  const apiKey = opts.apiKey || localStorage.getItem('wbe-api-key');
  const model = opts.model || localStorage.getItem('wbe-model') || 'gpt-4o';
  if (!apiUrl || !apiKey) throw new Error('未配置 API');
  const controller = new AbortController();
  const timer = setTimeout(() => { try { controller.abort(); } catch (e) {} }, AUX_REQUEST_TIMEOUT_MS);
  try {
    const resp = await streamFetch(apiUrl, apiKey, { model, messages }, controller.signal);
    let content = '';
    for await (const chunk of streamSSE(resp)) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) content += delta.content;
    }
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

// ===== AI 会话标题：首条消息后异步生成，失败回退截取法 =====
let titleGenerating = false;

async function maybeGenerateTitle() {
  const cur = sessions.find(s => s.id === activeSessionId);
  if (!cur || cur.aiTitled || titleGenerating) return;
  const first = chatMessages.find(m => m.role === 'user');
  if (!first) return;
  const targetId = activeSessionId; // 快照：标题只写给发起时的会话，避免流式期间切换会话写错
  titleGenerating = true;
  try {
    const text = await fetchCompletion([
      { role: 'system', content: '你是标题生成器。根据对话开头概括一个简洁的对话标题：不超过 10 个汉字，不要标点，不要引号，不要解释，直接输出标题。' },
      { role: 'user', content: '对话开头：' + String(first.content || '').slice(0, 200) }
    ]);
    const t = (text || '').replace(/["'「」『』【】]/g, '').trim();
    if (t && t.length <= 20) {
      const s = sessions.find(x => x.id === targetId);
      if (s && !s.aiTitled) {
        s.title = t;
        s.aiTitled = true;
        saveChatHistory();
      }
    }
  } catch (e) {
    console.warn('[WBE] 标题生成失败，保留截取标题:', e.message);
  } finally {
    titleGenerating = false;
  }
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

// 注入 system：所有大总结全文 + 最近未压缩的小总结（总长上限 8000 字符，防止上下文膨胀）
const MEMORY_INJECTION_MAX = 8000;
const MEMORY_INJECTION_TIGHT = 2500; // 超预算时压缩记忆注入的上限

function buildMemoryInjection(maxChars = MEMORY_INJECTION_MAX) {
  const parts = [];
  if (memory.rollups.length) {
    parts.push('【长期记忆 · 阶段总结】\n' + memory.rollups.map(r => '· ' + r.text).join('\n'));
  }
  const recent = recentTurns();
  if (recent.length) {
    const lines = recent.map((t, i) => {
      const seg = [];
      if (t.actionSummary) seg.push(t.actionSummary);
      else if (t.toolSummary) seg.push('完成了相关查询或修改');
      if (t.reply) seg.push(t.reply);
      return (i + 1) + '. ' + seg.join(' → ');
    });
    // 按预算截断：优先保留最新的近期操作
    let used = 0;
    const kept = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      if (used + lines[i].length > 6500) break;
      kept.unshift(lines[i]);
      used += lines[i].length;
    }
    if (kept.length < lines.length) kept.push('…(更早的操作已省略)');
    parts.push('【近期操作（细节，避免重复查询已知信息）】\n' + kept.join('\n'));
  }
  const joined = parts.join('\n\n');
  if (!joined) return '';
  return '\n\n' + (joined.length <= maxChars ? joined : joined.slice(0, maxChars) + '\n…(记忆注入已截断)');
}

// 确保当前 memory 与 currentBookId 对应（换书/刷新后用）。currentBookId 是 live binding。
// 记忆挂在会话对象上，loadChatHistory 内部同步 memory。
export async function ensureMemoryLoaded() {
  if (currentBookId !== logBookId) {
    await loadChatHistory(currentBookId);
    renderChatHistory();
    logBookId = currentBookId;
  }
}

let memTabState = 'sessions'; // 弹窗默认打开会话标签（会话栏已移除，这里是主入口）

function setMemTab(tab) {
  memTabState = tab;
  document.querySelectorAll('#memoryModal .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const s = $('tab-sessions');
  const m = $('tab-memory');
  if (s) s.hidden = tab !== 'sessions';
  if (m) m.hidden = tab !== 'memory';
  if (tab === 'sessions') renderSessionList();
  if (tab === 'memory') renderMemoryList();
  const sheet = document.querySelector('#memoryModal .sheet');
  if (sheet) sheet.scrollTop = 0;
}

async function openMemoryModal() {
  await ensureMemoryLoaded(); // 等书数据同步完再渲染弹窗，避免显示旧会话/记忆
  setMemTab(memTabState);
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
    '<button type="button" class="template-tab' + (index === 0 ? ' active' : '') + '" data-template-tab="' + escAttr(field) + '">' + escHtml(label.replace('模板', '')) + '</button>'
  ).join('') + '</div>' +
  '<div class="template-panes">' + WRITING_TEMPLATE_FIELDS.map(([field, label], index) =>
    '<label class="field template-pane' + (index === 0 ? ' active' : '') + '" data-template-pane="' + escAttr(field) + '"><span>' + escHtml(label) + '</span>' +
    '<textarea class="template-textarea" data-template-field="' + escAttr(field) + '" rows="13" placeholder="例如：\n段落标题：写作要求\n禁忌：不要写空框架，不要泛泛而谈">' + escHtml(template[field] || '') + '</textarea></label>'
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

  if ($btnSendChat) $btnSendChat.addEventListener('click', () => {
    if (isSending) { abortActiveChat('user'); return; } // 生成中点击 → 停止
    sendChat();
  });

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
  const $sessionSearch = $('sessionSearchInput');
  if ($sessionSearch) $sessionSearch.addEventListener('input', () => {
    sessionQuery = $sessionSearch.value.trim();
    renderSessionList();
  });
  const $memorySearch = $('memorySearchInput');
  if ($memorySearch) $memorySearch.addEventListener('input', () => {
    memoryQuery = $memorySearch.value.trim();
    renderMemoryList();
  });
  const $openTemplate = $('openTemplateBtn');
  if ($openTemplate) $openTemplate.addEventListener('click', openTemplateModal);
  const $saveTemplate = $('saveTemplateBtn');
  if ($saveTemplate) $saveTemplate.addEventListener('click', saveTemplateForm);
  const $resetTemplate = $('resetTemplateBtn');
  if ($resetTemplate) $resetTemplate.addEventListener('click', () => {
    try {
      const key = writingTemplateKey(currentBookId);
      localStorage.removeItem(key);
      import('./writing-template.js').then(() => {
        renderTemplateForm();
        import('./utils.js').then(m => m.showToast('已恢复内置默认模板', 'success'));
      });
    } catch (e) {
      import('./utils.js').then(m => m.showToast('恢复失败: ' + e.message, 'error'));
    }
  });
  const $generateTemplate = $('generateTemplateBtn');
  if ($generateTemplate) $generateTemplate.addEventListener('click', generateTemplateWithAI);
  const $clearMem = $('clearMemoryBtn');
  if ($clearMem) $clearMem.addEventListener('click', () => {
    ensureMemoryLoaded();
    memory = emptyMemory();
    const cur = sessions.find(s => s.id === activeSessionId);
    if (cur) cur.memory = emptyMemory();
    persistPut(logBookId, { sessions });
    updateMemoryBadge();
    renderMemoryList();
    import('./utils.js').then(m => m.showToast('已清空当前会话的记忆', 'success'));
  });
  // 启动时加载当前书的记忆/会话（书未加载时跳过，由 bootApp 的 ensureMemoryLoaded 统一加载）
  if (currentBookId != null) {
    logBookId = currentBookId;
    loadChatHistory(currentBookId).then(() => renderChatHistory());
    updateMemoryBadge();
  }

  // 多会话：记忆弹窗 Sessions 标签（会话栏已移除，入口为右上角记忆按钮）
  const $sessionNewBtn = $('sessionNewBtn');
  if ($sessionNewBtn) $sessionNewBtn.addEventListener('click', newSession);
  const $sessionModal = $('memoryModal');
  if ($sessionModal) {
    // 双标签：Sessions / Memory
    $sessionModal.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setMemTab(b.dataset.tab)));
    $sessionModal.addEventListener('click', (e) => {
      const del = e.target.closest('.session-del');
      if (del) { e.stopPropagation(); deleteSession(del.dataset.del); return; }
      const item = e.target.closest('.session-item');
      if (item) switchSession(item.dataset.session);
    });
  }

  if ($clear) {
    $clear.addEventListener('click', () => {
      abortActiveChat('switch'); // 清空对话时中断在途流式回复
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

// ===== 消息操作行：重新生成(仅 assistant) / 编辑 / 删除 + token 标签 =====
// msgEl 可能是 .chat-msg-text（流式气泡）或外层 .chat-msg：按钮行统一挂外层气泡
// idx 缺省时取最后一条消息（流式完成场景，修复此前 undefined 索引导致点击无效）
// 复制消息文本：navigator.clipboard 失败时降级 textarea + execCommand（http 环境可用）
function copyMsgText(i) {
  const m = chatMessages[i];
  const text = m ? String(m.content || '') : '';
  if (!text) { import('./utils.js').then(u => u.showToast('没有可复制的内容', 'info')); return; }
  const done = () => import('./utils.js').then(u => u.showToast('已复制到剪贴板', 'success'));
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) done(); else import('./utils.js').then(u => u.showToast('复制失败', 'error'));
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else fallback();
}

function attachMsgRow(msgEl, idx) {
  const host = msgEl && msgEl.classList.contains('chat-msg-text') ? msgEl.parentElement : msgEl;
  if (!host || host.querySelector('.chat-msg-actions')) return;
  const i = idx != null ? Number(idx) : chatMessages.length - 1;
  const m = chatMessages[i];
  if (!m || (m.role !== 'user' && m.role !== 'assistant')) return;
  const row = document.createElement('div');
  row.className = 'chat-msg-actions';
  if (m.role === 'assistant') {
    const resend = document.createElement('button');
    resend.type = 'button';
    resend.className = 'chat-msg-act';
    resend.title = '重新生成';
    resend.setAttribute('aria-label', '重新生成');
    resend.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a9 9 0 0 1 15-6.7L21 8"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a9 9 0 0 1-15 6.7L3 16"/></svg><span>重新生成</span>';
    resend.addEventListener('click', resendLast);
    row.appendChild(resend);
  }
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'chat-msg-act';
  copy.title = '复制这条消息';
  copy.setAttribute('aria-label', '复制这条消息');
  copy.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>复制</span>';
  copy.addEventListener('click', () => copyMsgText(i));
  row.appendChild(copy);
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'chat-msg-act';
  edit.title = '编辑这条消息';
  edit.setAttribute('aria-label', '编辑这条消息');
  edit.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>编辑</span>';
  edit.addEventListener('click', () => startEditMsg(msgEl, i));
  row.appendChild(edit);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'chat-msg-act';
  del.title = '删除这条消息';
  del.setAttribute('aria-label', '删除这条消息');
  del.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg><span>删除</span>';
  del.addEventListener('click', () => deleteMsg(i, msgEl));
  row.appendChild(del);
  // token 标签：assistant 消息带该轮上下文估算（彩色胶囊，持久化在消息对象上）
  if (m.role === 'assistant' && m.tokens) {
    const pill = document.createElement('span');
    pill.className = 'chat-token-pill' + (m.tokens > TOKEN_BUDGET ? ' over' : '');
    pill.textContent = '≈ ' + m.tokens.toLocaleString() + ' tok';
    pill.title = '该轮发送给模型的上下文估算';
    row.appendChild(pill);
  }
  host.appendChild(row);
}

// 从工具参数里取草稿标题（预览中断时用）
function draftTitleOf(toolName, args) {
  try {
    const a = typeof args === 'string' ? JSON.parse(args) : (args || {});
    return (a && a.title) || (a && a.userRequest ? String(a.userRequest).slice(0, 16) : '');
  } catch { return ''; }
}

// ===== 一键整理全书：体检 + 输出整改计划（执行需用户确认） =====
function toolCleanupBook() {
  const report = toolCheckEntries();
  const info = toolBookInfo();
  return {
    summary: '体检完成：' + report.summary + '（' + info.summary + '）',
    detail: '『当前书概览』\n' + info.detail.split('\n').slice(0, 4).join('\n') +
      '\n\n『体检报告』\n' + report.detail +
      '\n\n请根据上述报告输出逐项整改计划（条目、问题、处理方式），等待用户确认后再执行修改。'
  };
}

function attachResendBtn(msgEl, idx) { attachMsgRow(msgEl, idx); }
function attachMsgActions(msgEl, idx) { attachMsgRow(msgEl, idx); }

function startEditMsg(msgEl, idx) {
  const i = idx != null ? Number(idx) : -1;
  const host = msgEl && msgEl.classList.contains('chat-msg-text') ? msgEl.parentElement : msgEl;
  if (!host || i < 0 || i >= chatMessages.length || host.classList.contains('chat-msg-editing')) return;
  const textEl = msgEl.classList.contains('chat-msg-text') ? msgEl : msgEl.querySelector('.chat-msg-text');
  const cur = chatMessages[i];
  if (!textEl || !cur) return;
  host.classList.add('chat-msg-editing');
  const ta = document.createElement('textarea');
  ta.className = 'chat-msg-edit-textarea';
  ta.value = cur.content;
  const saveBtn = document.createElement('button');
  saveBtn.className = 'action primary';
  saveBtn.textContent = '保存';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'action';
  cancelBtn.textContent = '取消';
  const actions = document.createElement('div');
  actions.className = 'chat-msg-edit-actions';
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  textEl.innerHTML = '';
  textEl.appendChild(ta);
  textEl.appendChild(actions);
  ta.focus();
  saveBtn.addEventListener('click', () => {
    const v = ta.value.trim();
    if (!v) { import('./utils.js').then(m => m.showToast('内容不能为空', 'error')); return; }
    cur.content = v;
    // 首条 user 消息变化时同步会话标题（未 AI 命名时）
    const s = sessions.find(x => x.id === activeSessionId);
    if (s && !s.aiTitled) s.title = titleFromMessages(chatMessages);
    saveChatHistory();
    renderChatHistory(); // 全量重渲染，统一恢复编辑/删除按钮与索引
    import('./utils.js').then(m => m.showToast('已更新消息', 'success'));
  });
  cancelBtn.addEventListener('click', () => renderChatHistory());
}

function deleteMsg(idx, msgEl) {
  const i = idx != null ? Number(idx) : -1;
  if (i < 0 || i >= chatMessages.length) return;
  const role = chatMessages[i].role;
  if (role !== 'user' && role !== 'assistant') return;
  chatMessages.splice(i, 1);
  saveChatHistory();
  const host = msgEl && msgEl.classList.contains('chat-msg-text') ? msgEl.parentElement : msgEl;
  if (host && host.parentElement) host.remove();
  import('./utils.js').then(m => m.showToast('已删除该消息', 'success'));
}

function resendLast() {
  if (isSending) return;
  const last = chatMessages[chatMessages.length - 1];
  if (!last || last.role !== 'assistant') return;
  chatMessages.pop();
  saveChatHistory();
  const bubbles = document.querySelectorAll('#chat-messages .chat-msg-assistant');
  const lastEl = bubbles[bubbles.length - 1];
  if (lastEl) lastEl.remove();
  let userText = '';
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    if (chatMessages[i].role === 'user') { userText = chatMessages[i].content; break; }
  }
  if (!userText) return;
  sendChat(userText);
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
  // 冲刷最后一帧：rAF 节流下最后一帧可能仍在排队，这里以「非流式」姿态补一帧收尾
  renderAssistantStream(msgEl, content, reasoning, false);
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

// 流式渲染：requestAnimationFrame 节流（同一帧最多渲染一次），
// 结构稳定后只增量更新正文/思考内容，避免每个 delta 全量重写 + 全量 markdown 解析。
// 非流式（reasoningOpen=false，如流结束冲刷、最终回复）同步渲染，
// 保证后续 append 的子元素（如「重新生成」按钮）不会被延迟的 rAF 整帧重建抹掉。
let streamRenderRaf = null;
function renderAssistantStream(msgEl, content, reasoning, reasoningOpen = false) {
  const doRender = () => {
    const textEl = msgEl.querySelector('.stream-content');
    const rb = msgEl.querySelector('.reasoning-box');
    // 结构缺失（首帧 / 思考块新出现）才整体重建，否则增量更新
    const needRebuild = !textEl || (reasoning && !rb);
    if (needRebuild) {
      const parts = [];
      if (reasoning) {
        parts.push('<details class="reasoning-box"' + (reasoningDetailsShouldBeOpen(reasoning, reasoningOpen) ? ' open' : '') + '>' +
          '<summary>思考</summary>' +
          '<div class="reasoning-text">' + formatChatText(reasoning) + '</div>' +
          '</details>');
      }
      if (content) parts.push('<div class="stream-content">' + formatChatText(content) + '</div>');
      else if (!reasoning) parts.push('<span class="typing-cursor">◊</span>');
      msgEl.innerHTML = parts.join('');
    } else {
      if (content) textEl.innerHTML = formatChatText(content);
      else if (!reasoning) textEl.innerHTML = '<span class="typing-cursor">◊</span>';
      if (rb && reasoning) {
        const rt = rb.querySelector('.reasoning-text');
        if (rt) rt.innerHTML = formatChatText(reasoning);
      }
    }
  };
  if (reasoningOpen) {
    // 流式高频调用：同一帧只渲染最后一次
    if (streamRenderRaf) cancelAnimationFrame(streamRenderRaf);
    streamRenderRaf = requestAnimationFrame(() => {
      streamRenderRaf = null;
      doRender();
    });
  } else {
    if (streamRenderRaf) { cancelAnimationFrame(streamRenderRaf); streamRenderRaf = null; }
    doRender();
  }
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

// ===== AI 用量统计：当前书全部会话的估算 token 累计 =====
export function getChatUsage() {
  let tokens = 0;
  let withStats = 0;
  for (const s of sessions) {
    const t = (s.tokensTotal || 0) || s.messages.reduce((sum, m) => sum + ((m && m.tokens) || 0), 0);
    tokens += t;
    if (t > 0) withStats++;
  }
  return { sessions: sessions.length, tokens, withStats };
}

export function applyChatVisibleLimit() {  const container = $('chat-messages');
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
    // 忙碌时按钮变为「停止」：保持可点击，点击即中断生成（spinner 图标复用现有样式）
    btn.disabled = false;
    btn.setAttribute('aria-label', busy ? '停止生成' : '发送');
  }
  const input = $('chat-input');
  if (input) input.classList.toggle('sending', busy);
}

// ===== sendChat =====
const MAX_ROUNDS = 12;              // 工具调用轮数上限（原 25，平方级膨胀，降到 12 控制上下文）
const STREAM_TIMEOUT_MS = 120000;   // 主对话流式请求超时（超时自动 abort 并复位 UI）
const TOKEN_BUDGET = 16000;         // 每轮请求上下文 token 预算（超预算两档降级）
let lastTokensTotal = 0;            // 最近一轮实际发送的上下文估算（写入 assistant 消息，按钮行显示）

// 单个工具执行异常隔离：出错时把错误消息作为结果返回给模型，继续后续工具
const MUTATING_TOOL_NAMES = new Set([
  'edit_entry', 'add_entry', 'add_entries', 'create_smart_entry',
  'delete_entry', 'delete_entries', 'batch_edit', 'replace_text',
  'manage_keys', 'move_entry', 'toggle_entry', 'reorder_entry',
  'duplicate_entry', 'merge_entries', 'split_entry'
]);

async function safeExecuteTool(name, args) {
  // Turn-level rollback is a separate boundary from per-command undo.
  // Read-only tools must not create fake undo history.
  if (turnUndoBase === -1 && MUTATING_TOOL_NAMES.has(name)) {
    snapshotForUndo('AI 回合开始');
    turnUndoBase = undoStackLength();
  }
  try {
    return await executeTool(name, args);
  } catch (e) {
    console.warn('[WBE] 工具执行异常:', name, e);
    return { summary: name + ' 执行失败', detail: '工具 ' + name + ' 执行出错: ' + (e && e.message ? e.message : String(e)) };
  }
}

async function sendChat(prevText) {
  if (isSending) return; // 防止重复发送
  const input = $('chat-input');
  const text = prevText != null ? prevText : (input ? input.value.trim() : '');
  if (!text) return;
  if (prevText == null) {
    input.value = '';
    input.style.height = 'auto'; // 复位自动高度
  }

  const apiUrl = localStorage.getItem('wbe-api-url');
  const apiKey = localStorage.getItem('wbe-api-key');
  const model = localStorage.getItem('wbe-model') || 'gpt-4o';
  const systemPrompt = localStorage.getItem('wbe-system-prompt') || DEFAULT_SYSTEM_PROMPT;

  if (!apiUrl || !apiKey) {
    import('./utils.js').then(m => m.showToast('请先在设置中配置 API 地址和 Key', 'error'));
    return;
  }

  // 换世界书时切换到对应书的记忆（不同书的记忆互不相关，持久化各存各的）
  await ensureMemoryLoaded();

  // 没有活动会话时自动创建一个：保证首条消息就进入持久化会话，刷新后不丢
  if (!sessions.some(s => s.id === activeSessionId)) {
    const s = makeSession();
    sessions.push(s);
    activeSessionId = s.id;
    saveChatHistory();
  }

  if (prevText == null) {
    chatMessages.push({ role: 'user', content: text });
    appendChatMessage('user', text, chatMessages.length - 1);
    trimHistory();
    maybeGenerateTitle(); // 首条消息后异步生成 AI 标题（不阻塞对话）
  }

  const curBookName = ($('file-name') && $('file-name').textContent) || '未命名';
  const bookCtx = '\n\n当前世界书:「' + curBookName + '」，共 ' + entries.length + ' 个条目。如需多步操作（如先搜索再修改），可以连续调用工具，系统会把每步结果返回给你。你也可以用 list_books / switch_book / create_book / rename_book / get_book_info 管理整本世界书。';
  let systemMsg = systemPrompt + bookCtx + buildMemoryInjection();
  let messages = [
    { role: 'system', content: systemMsg },
    ...chatMessages
  ];

  // 上下文 token 预算：超预算时两档降级（压缩记忆注入 → 折叠最旧历史），控制成本与延迟
  let budgetLevel = 0; // 0 正常 / 1 压缩注入 / 2 折叠历史
  if (countMessagesTokens(messages) > TOKEN_BUDGET) {
    systemMsg = systemPrompt + bookCtx + buildMemoryInjection(MEMORY_INJECTION_TIGHT);
    messages = [
      { role: 'system', content: systemMsg },
      ...chatMessages
    ];
    if (countMessagesTokens(messages) > TOKEN_BUDGET) {
      messages = trimToBudget(messages, TOKEN_BUDGET);
      budgetLevel = 2;
    } else {
      budgetLevel = 1;
    }
  }
  lastTokensTotal = countMessagesTokens(messages);
  void budgetLevel;

  // 流开始时的会话/世界书快照：提交结果前校验，防止写进切换后的会话/书本
  const sessionIdAtStart = activeSessionId;
  const bookIdAtStart = currentBookId;
  turnUndoBase = -1; // 首个真正写工具执行时由 safeExecuteTool 建立 AI 回合回滚边界
  setSendBusy(true);

  try {
    const outcome = await runConversationTurn({
      messages,
      maxRounds: MAX_ROUNDS,

      // Transport + streaming UI stay in chat.js as an adapter. The engine only receives
      // the parsed round result plus an opaque context handle for presentation callbacks.
      requestRound: async ({ messages: roundMessages }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          if (activeChatAbort && activeChatAbort.controller === controller) activeChatAbort.reason = 'timeout';
          try { controller.abort(); } catch (e) {}
        }, STREAM_TIMEOUT_MS);
        activeChatAbort = { controller, reason: null, sessionId: sessionIdAtStart };
        try {
          const response = await streamFetch(
            apiUrl,
            apiKey,
            { model, messages: roundMessages, tools: getTools(), tool_choice: 'auto' },
            controller.signal
          );
          const msgEl = createAssistantBubble();
          const result = await streamDisplay(response, msgEl);
          return { result, context: msgEl };
        } finally {
          clearTimeout(timer);
          // activeChatAbort intentionally stays readable until the outer catch/finally.
        }
      },

      executeTool: safeExecuteTool,

      onToolAssistant: async ({ aiText, result, context: msgEl }) => {
        if (aiText) renderAssistantStream(msgEl, aiText, result.reasoning, false);
        else if (!hasVisibleAssistantStream(result.content, result.reasoning) && msgEl && msgEl.parentElement) msgEl.parentElement.remove();
      },

      onToolResult: async ({ name, result }) => {
        appendChatMessage('tool', name + ': ' + result.summary);
      }
    });

    if (outcome.status === 'preview-stop') {
      const call = outcome.previewCall || { name: '', args: {} };
      const previewText = outcome.mode === 'native'
        ? '已生成预览「' + (draftTitleOf(call.name, call.args) || '草稿') + '」，请在弹窗中确认或取消。'
        : '已生成预览，请在弹窗中确认或取消。';
      chatMessages.push({ role: 'assistant', content: previewText });
      trimHistory();
      return;
    }

    if (outcome.status === 'final') {
      const clean = outcome.content;
      const msgEl = outcome.context;
      if (clean !== outcome.rawContent) renderAssistantStream(msgEl, clean, outcome.reasoning, false);
      if (!turnStillActive(sessionIdAtStart, bookIdAtStart)) {
        import('./utils.js').then(m => m.showToast('会话已切换，本次回复已丢弃', 'info'));
        return;
      }
      chatMessages.push({ role: 'assistant', content: clean, tokens: lastTokensTotal });
      accumulateSessionTokens();
      trimHistory();
      attachResendBtn(msgEl);
      if (outcome.turnChanges.length) appendChangesCard(outcome.turnChanges);
      pushTurnMemory({ user: text, trace: outcome.turnTrace, reply: clean });
      maybeRollup();
      return;
    }

    // 达到轮数上限也要把已发生的过程存进历史，否则这一整轮全丢
    if (!turnStillActive(sessionIdAtStart, bookIdAtStart)) {
      import('./utils.js').then(m => m.showToast('会话已切换，本次回复已丢弃', 'info'));
      return;
    }
    const fallbackReply = '(本回合操作较多未给出总结)';
    chatMessages.push({ role: 'assistant', content: fallbackReply, tokens: lastTokensTotal });
    accumulateSessionTokens();
    trimHistory();
    pushTurnMemory({ user: text, trace: outcome.turnTrace, reply: fallbackReply });
    maybeRollup();
    appendChatMessage('error', '已达最大工具调用轮数(' + MAX_ROUNDS + ')，已停止。');
  } catch (e) {
    const aborted = !!(e && (e.name === 'AbortError' || e.name === 'TimeoutError'));
    if (aborted) {
      const reason = activeChatAbort ? activeChatAbort.reason : null;
      if (reason === 'switch') {
        import('./utils.js').then(m => m.showToast('已停止当前回复', 'info'));
      } else if (reason === 'user') {
        import('./utils.js').then(m => m.showToast('已停止生成', 'info'));
      } else {
        import('./utils.js').then(m => m.showToast('请求超时，已自动停止', 'error'));
        if (turnStillActive(sessionIdAtStart, bookIdAtStart)) appendChatMessage('error', '请求超时，已自动停止。');
      }
    } else {
      import('./utils.js').then(m => m.showToast('请求失败: ' + e.message, 'error'));
      if (turnStillActive(sessionIdAtStart, bookIdAtStart)) appendChatMessage('error', '请求失败: ' + e.message);
    }
  } finally {
    if (activeChatAbort) activeChatAbort = null;
    setSendBusy(false);
  }
}

function appendChatMessage(role, text, idx) {
  const container = $('chat-messages');
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // 工具调用：连续的折叠进同一个分组，避免一堆调用刷屏
  if (role === 'tool') { appendToolLine(container, text); return; }

  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-' + role;
  div.dataset.idx = idx != null ? idx : chatMessages.length;
  div.innerHTML = '<div class="chat-msg-role">' + ({user:'你',assistant:'AI',tool:'工具',error:'错误'}[role]||role) + '</div>' +
    '<div class="chat-msg-text">' + escHtml(text) + '</div>';
  container.appendChild(div);
  if (role === 'assistant') attachResendBtn(div, div.dataset.idx);
  else if (role === 'user') attachMsgActions(div, div.dataset.idx);
  applyChatVisibleLimit();
  // 自己发的消息和错误强制滚底；其余贴底才跟随
  if (role === 'user' || role === 'error' || isChatNearBottom()) scrollChatToBottom();
}

// ===== 本轮改动卡片：回合内条目级改动汇总，可点条目跳转、一键撤销本轮 =====
let turnUndoBase = 0; // sendChat 开始时撤销栈深度（一键撤销恢复到该点）

function appendChangesCard(changes) {
  const container = $('chat-messages');
  if (!container) return;
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-changes';
  const head = document.createElement('div');
  head.className = 'chat-msg-role';
  head.textContent = '本轮改动 · ' + changes.length + ' 项';
  const list = document.createElement('div');
  list.className = 'changes-list';
  const icons = { add: '＋', delete: '✕', edit: '✎', merge: '⤷', split: '⧉', other: '·' };
  for (const c of changes) {
    const label = (icons[c.type] || icons.other) + ' ' + (c.tool || '') + (c.comment ? '「' + c.comment + '」' : '') + (c.detail ? ' — ' + c.detail : '');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'change-item' + (c.type === 'delete' ? ' del' : '');
    btn.textContent = label;
    btn.title = c.type === 'delete' ? '该条目已删除' : '打开条目';
    if (c.uid != null && c.type !== 'delete') {
      const uid = c.uid;
      btn.addEventListener('click', () => {
        selectEntry(uid);
        document.dispatchEvent(new CustomEvent('wbe:goto-editor'));
      });
    } else {
      btn.disabled = true;
    }
    list.appendChild(btn);
  }
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'changes-undo';
  undoBtn.textContent = '⟲ 撤销本轮 ' + changes.length + ' 项';
  undoBtn.addEventListener('click', () => undoThisTurn(turnUndoBase));
  div.appendChild(head);
  div.appendChild(list);
  div.appendChild(undoBtn);
  container.appendChild(div);
  applyChatVisibleLimit();
  if (isChatNearBottom()) scrollChatToBottom();
}

// 一键撤销本轮全部改动（恢复到回合开始时的「回合开始」快照）
function undoThisTurn(base) {
  if (isSending || base <= 0) return;
  const labels = restoreUndoTo(base);
  if (!labels) {
    import('./utils.js').then(m => m.showToast('本轮没有可撤销的操作', 'info'));
    return;
  }
  renderSidebar();
  const cur = entries.find(e => e.uid === currentUid) || entries[0];
  if (cur) selectEntry(cur.uid);
  else renderEditorEmpty();
  scheduleSave();
  import('./utils.js').then(m => m.showToast('已撤销本轮 ' + labels.length + ' 步', 'success'));
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

async function executeTool(name, args) {
  console.log('[WBE] executeTool:', name, 'args keys:', Object.keys(args || {}).join(',')); // 不打印参数内容，避免敏感信息泄漏
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
    case 'merge_entries': return toolMergeEntries(args || {});
    case 'split_entry': return toolSplitEntry(args || {});
    case 'check_entries': return toolCheckEntries();
    case 'test_triggers': return toolTestTriggers(args || {});
    case 'export_book': return toolExportBook();
    case 'web_search': return await toolWebSearch(args || {});
    case 'cleanup_book': return toolCleanupBook();
    case 'find_duplicates': return toolFindDuplicates(args || {});
    case 'undo_last': return toolUndo(args);
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

function toolSearch(args) {
  return searchEntries(getAllEntries(), args || {});
}

function toolGet(args) {
  return getEntry(getAllEntries(), args || {});
}

// 条目字段白名单（与 state.js createEntry 的字段一致）：AI 只能写这些字段，防止任意字段污染数据结构
const ENTRY_FIELD_TYPES = {
  key: 'array', keysecondary: 'array', triggers: 'array',
  comment: 'string', content: 'string', group: 'string', role: 'string',
  automationId: 'string', outletName: 'string',
  constant: 'boolean', selective: 'boolean', addMemo: 'boolean', groupOverride: 'boolean',
  useProbability: 'boolean', vectorized: 'boolean', excludeRecursion: 'boolean',
  preventRecursion: 'boolean', delayUntilRecursion: 'boolean', ignoreBudget: 'boolean',
  matchPersonaDescription: 'boolean', matchCharacterDescription: 'boolean',
  matchCharacterPersonality: 'boolean', matchCharacterDepthPrompt: 'boolean',
  matchScenario: 'boolean', matchCreatorNotes: 'boolean', disable: 'boolean',
  selectiveLogic: 'number', order: 'number', position: 'number', groupWeight: 'number',
  sticky: 'number', cooldown: 'number', delay: 'number', probability: 'number',
  depth: 'number', displayIndex: 'number', scanDepth: 'number', caseSensitive: 'number',
  matchWholeWords: 'number', useGroupScoring: 'number',
  characterFilter: 'object'
};

// 白名单字段类型归一：白名单外字段返回 undefined（丢弃），合法字段按类型转换
function normalizeEntryFieldValue(key, value) {
  const type = ENTRY_FIELD_TYPES[key];
  if (!type) return undefined;
  if (value === undefined) return undefined;
  if (value === null) {
    // 仅允许本就是可空字段写入 null
    return (key === 'role' || key === 'scanDepth' || key === 'caseSensitive' || key === 'matchWholeWords' || key === 'useGroupScoring') ? null : undefined;
  }
  switch (type) {
    case 'boolean': return Boolean(value);
    case 'number': { const n = Number(value); return Number.isFinite(n) ? n : 0; }
    case 'string': return String(value);
    case 'array': return Array.isArray(value) ? value.map(String) : (typeof value === 'string' ? value.split(/[,，]/).map(s => s.trim()).filter(Boolean) : []);
    case 'object': return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    default: return undefined;
  }
}

function toolEdit({ uid, fields }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const patch = {};
  const accepted = [];
  const ignored = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === 'uid') continue;
    const nv = normalizeEntryFieldValue(k, v);
    if (nv === undefined) { ignored.push(k); continue; }
    patch[k] = nv;
    accepted.push(k);
  }
  if (!accepted.length) return { summary: '没有可修改的合法字段', detail: '传入字段均不在白名单内或为空：' + ignored.join(', ') };
  const result = runWorldBookCommand({ type: CommandType.PATCH_ENTRY, uid, patch }, { label: '编辑 #' + uid });
  if (!result.changed) return { summary: '#' + uid + ' 没有实际变化', detail: '字段值与当前条目一致' };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  const ignoreNote = ignored.length ? '；忽略非法/未知字段: ' + ignored.join(', ') : '';
  return { summary: '已修改 #' + uid + ' 的 ' + accepted.join(','), detail: '修改字段: ' + accepted.join(', ') + ignoreNote, changes: [{ type: 'edit', uid, comment: e.comment || '', detail: accepted.join(',') }] };
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
  const uid = nextUid();
  const entry = createEntry(uid);
  if (comment) entry.comment = comment;
  if (content) entry.content = content;
  if (Array.isArray(key)) entry.key = key.map(String);
  if (typeof constant === 'boolean') entry.constant = constant;
  applyEntryMeta(entry, semanticType, functionType);
  const result = runWorldBookCommand({ type: CommandType.CREATE_ENTRY, entry }, { label: '新增条目' });
  if (!result.changed) return { summary: '新增失败', detail: '条目未发生写入' };
  renderSidebar();
  scheduleSave();
  return { summary: '已创建 #' + uid, detail: '新条目 UID: ' + uid, changes: [{ type: 'add', uid, comment: comment || '', detail: (content || '').length + ' 字' }] };
}

function toolAddMany({ entries: items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { summary: '未提供条目', detail: 'entries 需为非空数组' };
  }
  const prepared = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const entry = createEntry(prepared.length);
    if (it.comment) entry.comment = it.comment;
    if (it.content) entry.content = it.content;
    if (Array.isArray(it.key)) entry.key = it.key.map(String);
    if (typeof it.constant === 'boolean') entry.constant = it.constant;
    applyEntryMeta(entry, it.semanticType, it.functionType);
    prepared.push(entry);
  }
  if (!prepared.length) return { summary: '未提供有效条目', detail: 'entries 中没有可创建的对象' };
  const result = runWorldBookCommand({ type: CommandType.MERGE_ENTRIES, entries: prepared, skipDuplicates: false }, { label: '批量新增 ' + prepared.length + ' 条' });
  const created = result.createdUids;
  renderSidebar();
  scheduleSave();
  const uidStr = created.length > 8 ? created.slice(0, 8).join(',') + '…' : created.join(',');
  return {
    summary: '已新增 ' + created.length + ' 条 (UID ' + uidStr + ')',
    detail: '新条目 UID: ' + created.join(', '),
    changes: created.slice(0, 12).map(uid => {
      const e = entries.find(x => x.uid === uid);
      return { type: 'add', uid, comment: (e && e.comment) || '' };
    })
  };
}

async function toolCreateSmartEntry(args) {
  const draft = planWorldbookEntry(withWritingTemplate(args));
  const completed = await maybeCompleteSmartContent(draft, args);
  const r = commitSmartDraft(completed);
  const related = checkRelatedEntries(args);
  if (related) r.detail += related;
  r.detail += checkNewEntry(r.uid, completed);
  return r;
}

async function toolPlanSmartEntry(args) {
  const draft = planWorldbookEntry(withWritingTemplate(args));
  const completed = await maybeCompleteSmartContent(draft, args);
  const record = createSmartDraftRecord(completed);
  setActiveSmartDraft(smartDraftState, record);
  renderSmartDraftModal(record);
  const detail = smartDraftDetail(completed, null) + checkRelatedEntries(args);
  // stop: true → 中断工具循环，等待用户在预览弹窗确认/取消，禁止 AI 继续创建
  return { summary: '已生成智能条目预览「' + completed.title + '」，请在弹窗中确认', stop: true, detail: detail + '\n\n草稿 ID: ' + record.id + '\n请在弹窗中确认创建或取消，本回合已停止。' };
}

// 关联词条检查：正文涉及的实体若未建条，提示用户考虑创建（设定集联动）
function checkRelatedEntries(args) {
  const list = (Array.isArray(args && args.relatedEntries) ? args.relatedEntries : [])
    .filter(r => r && String(r.name || '').trim())
    .slice(0, 8);
  if (!list.length) return '';
  const existing = getAllEntries();
  const existingNames = new Set(existing.map(e => String(e.comment || '').trim()));
  const missing = list.filter(r => !existingNames.has(String(r.name).trim()));
  if (!missing.length) return '\n关联词条：正文涉及 ' + list.length + ' 个实体均已有条目，无需新建。';
  return '\n关联词条建议（现有条目中未找到，可考虑创建）：\n' + missing.map(r =>
    '· ' + r.name + '（' + (r.type || '未知类型') + '）' + (r.note ? ' — ' + r.note : '')
  ).join('\n');
}

// 检测正文是否不完整（指令性占位/段落缺失/过短），命中则让模型补全为完整正文
const PLACEHOLDER_RE = /需要写成|需要.*(?:设定|补充|描写)|围绕[^。]{0,12}补充|可直接进入对话上下文/;

async function maybeCompleteSmartContent(draft, args) {
  const content = String(draft.content || '').trim();
  const sections = Array.isArray(draft.templateSections) && draft.templateSections.length
    ? draft.templateSections
    : (TEMPLATES[draft.semanticType] || null);
  const covered = sections ? sections.filter(s => content.includes(s)).length : 0;
  const incomplete =
    PLACEHOLDER_RE.test(content) ||
    content.length < 30 ||
    (sections && covered < Math.min(3, sections.length));
  if (!incomplete) return draft;
  try {
    const text = await fetchCompletion([
      { role: 'system', content: '你是世界书设定写手。世界书条目应当像设定集词条：结构完整、信息分层、可考据、中立客观。正文必须覆盖四要素：人（职业/岗位/关键人物）、地（至少 2 个具体地点）、数（价格/时间/数量/比例）、则（流程/规则/代价），缺少要素是缺陷必须补全。人物/职业相关条目必须写详细外观：上衣款式材质颜色、下装、鞋、外搭、配饰、体貌特征，全部是旁观者可见的细节，禁止“穿着得体”等空泛词。篇幅按设定复杂度弹性——小条目 80–300 字，大卡可 500–1500 字甚至更长。根据条目主题和段落模板，把正文补全为可直接使用的完整设定：每个段落一行「段落名：内容」，内容要具体、有细节、可触发；已经写好的段落保留原文，只补缺失部分。严禁输出“需要写成…”“围绕…补充”等指令性文字，严禁空段落。' },
      { role: 'user', content: '条目主题：' + (draft.title || '') +
        '\n段落模板：' + (sections ? sections.join('、') : '（按内容自然分段）') +
        '\n现有内容：\n' + (content || '（无）') }
    ]);
    if (text && text.length > content.length * 0.6) {
      draft.content = text;
    }
  } catch (e) {
    console.warn('[WBE] 正文补全失败，保留原草稿:', e.message);
  }
  return draft;
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
  const uid = nextUid();
  const entry = createEntry(uid);
  applyDraftToEntry(entry, draft);
  const result = runWorldBookCommand({ type: CommandType.CREATE_ENTRY, entry }, { label: '智能新增条目' });
  if (!result.changed) return { summary: '智能创建失败', detail: '条目未发生写入', changes: [], uid: null };
  renderSidebar();
  scheduleSave();
  return { summary: '已智能创建 #' + uid + '「' + draft.title + '」', detail: smartDraftDetail(draft, uid), changes: [{ type: 'add', uid, comment: draft.title || '', detail: '智能创建' }], uid };
}

// 创建后体检联动：新条目自身风险 + 与全书的冲突/共享提示
function checkNewEntry(uid, draft) {
  const lines = [];
  for (const c of (draft.checks || [])) {
    if (c.level === 'warning' || c.level === 'danger') lines.push('[' + c.level + '] ' + c.message);
  }
  const report = toolCheckEntries();
  for (const l of String(report.detail || '').split('\n')) {
    if (l.includes('#' + uid)) lines.push(l);
  }
  if (!lines.length) return '\n新条目体检：未发现风险。';
  return '\n新条目体检：\n' + lines.join('\n');
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
  const target = getAllEntries().find(e => e.uid === uid);
  if (!target) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const title = target.comment || '';
  const result = runWorldBookCommand({ type: CommandType.DELETE_ENTRIES, uids: [uid] }, { label: '删除 #' + uid });
  if (!result.changed) return { summary: '未删除 #' + uid, detail: '条目未发生变化' };
  if (currentUid === uid) {
    import('./state.js').then(m => m.setCurrentUid(null));
    renderEditorEmpty();
  }
  renderSidebar();
  scheduleSave();
  return { summary: '已删除 #' + uid, detail: '已删除 UID ' + uid, changes: [{ type: 'delete', uid, comment: title }] };
}

// 共用条目筛选：constant / disable / uid_range / query
function applyEntryFilter(list, filter) {
  return filterEntries(list, filter);
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
  const delUids = targets.map(e => e.uid);
  const result = runWorldBookCommand({ type: CommandType.DELETE_ENTRIES, uids: delUids }, { label: '批量删除 ' + targets.length + ' 条' });
  if (!result.changed) return { summary: '无条目被删除', detail: '目标条目已不存在' };
  if (currentUid !== null && result.deletedUids.includes(currentUid)) {
    import('./state.js').then(m => m.setCurrentUid(null));
    renderEditorEmpty();
  }
  renderSidebar();
  scheduleSave();
  const dStr = result.deletedUids.length > 8 ? result.deletedUids.slice(0, 8).join(',') + '…' : result.deletedUids.join(',');
  return {
    summary: '已删除 ' + result.deletedUids.length + ' 条 (UID ' + dStr + ')',
    detail: '已删除 UID: ' + result.deletedUids.join(', '),
    changes: targets.filter(e => result.deletedUids.includes(e.uid)).slice(0, 12).map(e => ({ type: 'delete', uid: e.uid, comment: e.comment || '' }))
  };
}

function toolBatchEdit({ filter, fields }) {
  const list = applyEntryFilter(getAllEntries(), filter);
  if (list.length === 0) return { summary: '无匹配条目', detail: '筛选条件未匹配到任何条目，未做修改' };
  const patch = {};
  const changed = [];
  const ignored = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === 'uid') continue;
    const nv = normalizeEntryFieldValue(k, v);
    if (nv === undefined) { ignored.push(k); continue; }
    patch[k] = nv;
    changed.push(k);
  }
  if (!changed.length) return { summary: '没有可修改的合法字段', detail: '传入字段均不在白名单内或为空：' + ignored.join(', ') };
  const result = runWorldBookCommand({
    type: CommandType.PATCH_ENTRIES,
    patches: list.map(e => ({ uid: e.uid, patch }))
  }, { label: '批量修改 ' + list.length + ' 条' });
  if (!result.changed) return { summary: '匹配条目无需修改', detail: '目标字段已经是请求值' };
  renderSidebar();
  if (currentUid != null) {
    const current = entries.find(e => e.uid === currentUid);
    if (current && result.affectedUids.includes(current.uid)) renderEditor(current);
  }
  scheduleSave();
  const ignoreNote = ignored.length ? '；忽略非法/未知字段: ' + ignored.join(', ') : '';
  return {
    summary: '已批量修改 ' + result.affectedUids.length + ' 条',
    detail: '修改字段: ' + changed.join(', ') + '，影响 ' + result.affectedUids.length + ' 条' + ignoreNote,
    changes: list.filter(e => result.affectedUids.includes(e.uid)).slice(0, 12).map(e => ({ type: 'edit', uid: e.uid, comment: e.comment || '', detail: changed.join(',') }))
  };
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

  let targets;
  if (uid != null) {
    const e = getAllEntries().find(x => x.uid === uid);
    if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
    targets = [e];
  } else {
    targets = applyEntryFilter(getAllEntries(), filter);
  }
  if (!targets.length) return { summary: '无匹配条目', detail: '筛选条件未匹配到任何条目' };

  const countIn = (str) => {
    re.lastIndex = 0;
    const m = String(str).match(re);
    re.lastIndex = 0;
    return m ? m.length : 0;
  };
  const doRepl = (str) => {
    re.lastIndex = 0;
    const out = regex ? String(str).replace(re, replace) : String(str).replace(re, () => replace);
    re.lastIndex = 0;
    return out;
  };

  let total = 0;
  const pending = [];
  for (const e of targets) {
    let hit = 0;
    const patch = {};
    for (const col of cols) {
      if (col === 'key') {
        const arr = Array.isArray(e.key) ? e.key : [];
        const colHits = arr.reduce((sum, k) => sum + countIn(k), 0);
        if (colHits > 0) patch.key = arr.map(k => doRepl(k)).filter(k => k !== '');
        hit += colHits;
      } else if (typeof e[col] === 'string') {
        const colHits = countIn(e[col]);
        if (colHits > 0) patch[col] = doRepl(e[col]);
        hit += colHits;
      }
    }
    if (hit > 0) { pending.push({ entry: e, patch }); total += hit; }
  }
  if (total === 0) return { summary: '未找到「' + find + '」', detail: '在 ' + targets.length + ' 条目的 ' + cols.join('/') + ' 中没有匹配' };

  const result = runWorldBookCommand({
    type: CommandType.PATCH_ENTRIES,
    patches: pending.map(item => ({ uid: item.entry.uid, patch: item.patch }))
  }, { label: '替换「' + find + '」→「' + replace + '」(' + pending.length + ' 条)' });
  if (!result.changed) return { summary: '替换后没有实际变化', detail: '匹配结果与原值一致' };
  if (currentUid != null && result.affectedUids.includes(currentUid)) {
    const cur = entries.find(e => e.uid === currentUid);
    if (cur) renderEditor(cur);
  }
  renderSidebar();
  scheduleSave();
  return {
    summary: '已替换 ' + total + ' 处，影响 ' + result.affectedUids.length + ' 条',
    detail: '在 ' + cols.join('/') + ' 把「' + find + '」替换为「' + replace + '」' + (regex ? '（正则）' : '') + '，共 ' + total + ' 处 / ' + result.affectedUids.length + ' 个条目',
    changes: pending.filter(item => result.affectedUids.includes(item.entry.uid)).slice(0, 12).map(item => ({ type: 'edit', uid: item.entry.uid, comment: item.entry.comment || '', detail: '替换「' + find + '」' }))
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
  let arr = Array.isArray(e[field]) ? e[field].slice() : [];
  let added = 0, removed = 0;
  if (rmArr.length) {
    const rmSet = new Set(rmArr);
    const before = arr.length;
    arr = arr.filter(k => !rmSet.has(k));
    removed = before - arr.length;
  }
  for (const k of addArr) { if (!arr.includes(k)) { arr.push(k); added++; } }
  const result = runWorldBookCommand({ type: CommandType.PATCH_ENTRY, uid, patch: { [field]: arr } }, { label: '调整 #' + uid + ' 的' + label });
  if (!result.changed) return { summary: '无实际变化', detail: '#' + uid + ' 的' + label + '无需修改' };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  return {
    summary: '#' + uid + ' ' + label + ' +' + added + ' / -' + removed,
    detail: '#' + uid + ' 当前' + label + '：' + (arr.length ? arr.join('、') : '(空)'),
    changes: [{ type: 'edit', uid, comment: e.comment || '', detail: label + (added ? ' +' + added : '') + (removed ? ' -' + removed : '') }]
  };
}

// 设置条目插入位置 position（与 reorder 的 order 数值互补）
function toolMoveEntry({ uid, position, depth }) {
  const e = getAllEntries().find(x => x.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  if (typeof position !== 'number') return { summary: 'position 须为数字', detail: '收到的 position: ' + position };
  const names = { 0: '角色定义前', 1: '角色定义后', 2: '作者注释前', 3: '作者注释后', 4: '@深度' };
  const patch = { position };
  let extra = '';
  if (position === 4 && typeof depth === 'number') { patch.depth = depth; extra = '，深度 ' + depth; }
  const result = runWorldBookCommand({ type: CommandType.PATCH_ENTRY, uid, patch }, { label: '移动位置 #' + uid });
  if (!result.changed) return { summary: '#' + uid + ' 位置无需修改', detail: 'position/depth 已是目标值' };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  const posName = names[position] || ('position=' + position);
  return { summary: '#' + uid + ' 移到「' + posName + '」' + extra, detail: '#' + uid + ' position=' + position + '（' + posName + '）' + extra, changes: [{ type: 'edit', uid, comment: e.comment || '', detail: 'position=' + position }] };
}

function toolList(args = {}) {
  return listEntries(getAllEntries(), args);
}

function toolToggle({ uid, disable }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const next = (disable === undefined || disable === null) ? !e.disable : !!disable;
  const result = runWorldBookCommand({ type: CommandType.SET_ENTRY_FIELD, uids: [uid], field: 'disable', value: next }, { label: (next ? '禁用' : '启用') + ' #' + uid });
  if (!result.changed) return { summary: '#' + uid + ' 状态无需修改', detail: '当前已是目标状态' };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  const state = e.disable ? '已禁用' : '已启用';
  return { summary: '#' + uid + ' ' + state, detail: '#' + uid + ' (' + (e.comment||'') + ') ' + state, changes: [{ type: 'edit', uid, comment: e.comment || '', detail: state }] };
}

function toolReorder({ uid, order }) {
  const e = getAllEntries().find(e => e.uid === uid);
  if (!e) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  if (typeof order !== 'number') return { summary: 'order 须为数字', detail: '收到的 order: ' + order };
  const result = runWorldBookCommand({ type: CommandType.SET_ENTRY_FIELD, uids: [uid], field: 'order', value: order }, { label: '调整顺序 #' + uid });
  if (!result.changed) return { summary: '#' + uid + ' order 无需修改', detail: 'order 已是 ' + order };
  if (currentUid === uid) renderEditor(e);
  renderSidebar();
  scheduleSave();
  return { summary: '#' + uid + ' order=' + order, detail: '#' + uid + ' (' + (e.comment||'') + ') order 已设为 ' + order, changes: [{ type: 'edit', uid, comment: e.comment || '', detail: 'order=' + order }] };
}

function toolDuplicate({ uid }) {
  const srcEntry = getAllEntries().find(e => e.uid === uid);
  if (!srcEntry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const result = runWorldBookCommand({ type: CommandType.DUPLICATE_ENTRY, sourceUid: uid }, { label: '复制 #' + uid });
  if (!result.changed) return { summary: '复制失败', detail: '没有创建副本' };
  const newUid = result.createdUids[0];
  const copy = entries.find(e => e.uid === newUid);
  renderSidebar();
  scheduleSave();
  return { summary: '已复制 #' + uid + ' → #' + newUid, detail: '新副本 UID: ' + newUid + '（标题: ' + ((copy && copy.comment) || '') + '）', changes: [{ type: 'add', uid: newUid, comment: (copy && copy.comment) || '', detail: '复制自 #' + uid }] };
}

// ===== 合并条目 =====
function toolMergeEntries({ uids, keep }) {
  const list = getAllEntries();
  const targets = (Array.isArray(uids) ? uids : []).map(u => list.find(e => e.uid === u)).filter(Boolean);
  if (targets.length < 2) return { summary: '合并失败', detail: '需要至少 2 个存在的 UID，传入: ' + JSON.stringify(uids) };
  const keepUid = (keep != null && targets.some(t => t.uid === keep)) ? keep : targets[0].uid;
  const result = runWorldBookCommand({ type: CommandType.MERGE_EXISTING_ENTRIES, uids: targets.map(t => t.uid), keep: keepUid }, { label: '合并条目 ' + targets.map(t => '#' + t.uid).join('+') });
  if (!result.changed) return { summary: '合并失败', detail: '目标条目不足或没有变化' };
  const kept = entries.find(e => e.uid === result.keptUid);
  renderSidebar();
  if (currentUid != null && result.deletedUids.includes(currentUid)) selectEntry(result.keptUid);
  scheduleSave();
  return {
    summary: '已合并 ' + targets.length + ' 条 → #' + result.keptUid + '「' + ((kept && kept.comment) || '') + '」',
    detail: '保留 #' + result.keptUid + '，删除 ' + result.deletedUids.map(uid => '#' + uid).join('、') + '；关键词合并为: ' + ((kept && kept.key && kept.key.length) ? kept.key.join('、') : '(无)') + '。可 undo_last 回退。',
    changes: [
      { type: 'merge', uid: result.keptUid, comment: (kept && kept.comment) || '', detail: '合并 ' + targets.length + ' 条' },
      ...targets.filter(t => result.deletedUids.includes(t.uid)).slice(0, 11).map(t => ({ type: 'delete', uid: t.uid, comment: t.comment || '' }))
    ]
  };
}

// ===== 拆分条目 =====
function toolSplitEntry({ uid, parts }) {
  const srcEntry = getAllEntries().find(e => e.uid === uid);
  if (!srcEntry) return { summary: '未找到 #' + uid, detail: 'UID ' + uid + ' 不存在' };
  const list = Array.isArray(parts) ? parts.filter(p => p && String(p.comment || '').trim() && String(p.content || '').trim()) : [];
  if (list.length < 2) return { summary: '拆分失败', detail: 'parts 至少需要 2 个含标题和正文的条目' };
  const result = runWorldBookCommand({ type: CommandType.SPLIT_ENTRY, sourceUid: uid, parts: list }, { label: '拆分 #' + uid });
  if (!result.changed) return { summary: '拆分失败', detail: '条目未发生变化' };
  renderSidebar();
  if (currentUid === uid) {
    if (result.createdUids.length) selectEntry(result.createdUids[0]);
    else renderEditorEmpty();
  }
  scheduleSave();
  return {
    summary: '已拆分 #' + uid + ' → ' + result.createdUids.length + ' 条',
    detail: '新条目 UID: ' + result.createdUids.join('、') + '（可 undo_last 回退）',
    changes: [
      { type: 'split', uid, comment: srcEntry.comment || '', detail: '拆为 ' + result.createdUids.length + ' 条' },
      ...result.createdUids.slice(0, 12).map(newUid => ({ type: 'add', uid: newUid, comment: (entries.find(x => x.uid === newUid) || {}).comment || '' }))
    ]
  };
}

// ===== 查重：按标题相同/子串、关键词重叠、正文开头相同找疑似重复条目 =====
function toolFindDuplicates(args = {}) {
  return findDuplicates(getAllEntries(), args);
}

// ===== 全书体检 =====
// ===== 全书体检 =====
function toolCheckEntries() {
  return checkEntries(getAllEntries());
}

// ===== 触发预演 =====
function toolTestTriggers(args = {}) {
  return testTriggers(getAllEntries(), args);
}

// ===== 导出下载 =====
function toolExportBook() {
  const wb = worldBook;
  if (!wb) return { summary: '无可导出内容', detail: '当前没有打开的世界书' };
  const name = currentBookName() || 'world-book';
  const blob = new Blob([JSON.stringify(wb, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.json';  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return { summary: '已导出「' + name + '」(' + getAllEntries().length + ' 条)', detail: 'JSON 文件已开始下载，可直接导入 SillyTavern。' };
}

// ===== 联网搜索 =====
async function toolWebSearch({ query, limit }) {
  const q = String(query || '').trim();
  if (!q) return { summary: '缺少搜索词', detail: '请提供要搜索的内容' };
  const { authHeaders } = await import('./auth.js');
  const resp = await fetch('/api/proxy/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ q })
  });
  if (resp.status === 503) {
    return { summary: '搜索服务被限流', detail: '搜索服务暂时被限流（反爬），请稍后重试或换关键词。你可以先用现有知识创作，稍后再补查。' };
  }
  if (!resp.ok) throw new Error('搜索接口 HTTP ' + resp.status);
  const data = await resp.json();
  const list = (data.results || []).slice(0, Math.max(1, Math.min(parseInt(limit, 10) || 3, 5)));
  if (!list.length) return { summary: '搜索无结果', detail: '「' + q + '」没有找到结果，可换关键词重试' };
  const lines = list.map((r, i) =>
    (i + 1) + '. ' + r.title + '\n   ' + r.url + '\n   ' + (r.snippet || '(无摘要)')
  );
  return { summary: '搜索到 ' + list.length + ' 条（' + q + '）', detail: lines.join('\n\n') };
}

function toolUndo(args) {
  const steps = Math.max(1, Math.min(parseInt(args && args.steps, 10) || 1, 10));
  let label = null;
  let undone = 0;
  for (let i = 0; i < steps; i++) {
    const l = restoreUndo();
    if (!l) break;
    label = l;
    undone++;
  }
  if (!undone) return { summary: '无可撤销操作', detail: '撤销栈为空，没有可恢复的修改' };
  renderSidebar();
  if (currentUid) {
    const e = entries.find(x => x.uid === currentUid);
    if (e) renderEditor(e);
    else { import('./state.js').then(m => m.setCurrentUid(null)); renderEditorEmpty(); }
  }
  scheduleSave();
  if (undone > 1) return { summary: '已撤销 ' + undone + ' 步操作', detail: '最后一步是「' + label + '」，已恢复到更早状态' };
  return { summary: '已撤销「' + label + '」', detail: '已恢复到「' + label + '」操作之前的状态' };
}

// ===== 世界书级工具 =====
function currentBookName() {
  const el = $('file-name');
  return (el && el.textContent) || '未命名';
}

function toolBookInfo() {
  return buildBookInfo(getAllEntries(), { name: currentBookName(), bookId: currentBookId });
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
  abortActiveChat('switch'); // 切书即中断在途流式回复
  await loadBook(target.id, renderSidebar, selectEntry, renderEditorEmpty);
  return { summary: '已切换到「' + target.name + '」', detail: '已打开世界书 #' + target.id + '（' + target.name + '），现有 ' + entries.length + ' 条' };
}

async function toolCreateBook({ name }) {
  const bookName = (name && String(name).trim()) || '新世界书';
  const res = await createBook(bookName);
  abortActiveChat('switch');
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

  // 一并清理该书在 localStorage 的记忆/会话/活动会话键（含旧版单会话历史）
  try {
    localStorage.removeItem(memKey(target.id));
    localStorage.removeItem(sessionsKey(target.id));
    localStorage.removeItem(activeKey(target.id));
    localStorage.removeItem('wbe-chat:' + target.id);
  } catch (e) {
    console.warn('[WBE] 清理已删世界书的本地数据失败:', target.id, e);
  }

  let tail = '';
  if (wasCurrent) {
    abortActiveChat('switch');
    memory = emptyMemory();
    logBookId = null;
    sessions = [];
    activeSessionId = null;
    updateMemoryBadge();
    const rest = await loadBookList();
    if (rest.length) {
      await loadBook(rest[0].id, renderSidebar, selectEntry, renderEditorEmpty);
      tail = '，已切换到「' + rest[0].name + '」';
    } else {
      const st = await import('./state.js');
      st.setCurrentBookId(null); st.setCurrentUid(null);
      setEntries([]); renderSidebar(); renderEditorEmpty();
      const el = $('file-name'); if (el) el.textContent = '未命名';
      chatMessages.length = 0;
      renderChatHistory();
      tail = '，已无其它世界书';
    }
    ensureMemoryLoaded(); // 加载新当前书的记忆与会话（logBookId 已置空会触发重载）
  }
  return { summary: '已删除「' + target.name + '」', detail: '世界书 #' + target.id + '（' + target.name + '）已永久删除' + tail };
}
