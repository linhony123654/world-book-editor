// ===== AI 聊天 =====
import { escHtml, escAttr, $ } from './utils.js';
import { worldBook, entries, currentUid, currentBookId, nextUid, createEntry, setEntries, snapshotForUndo, restoreUndo, undoStackLength, restoreUndoTo } from './state.js';
import { renderSidebar, selectEntry } from './sidebar.js';
import { renderEditor, renderEditorEmpty } from './editor.js';
import { scheduleSave, apiRequest, loadBookList, loadBook, createBook, renameBook, deleteBook } from './api.js';
import { summarizeToolTraceForMemory } from './memory-summary.js';
import { extractReasoningDelta, hasVisibleAssistantStream } from './reasoning.js';
import { applyVisibleLimitToChildren, readChatVisibleLimit } from './chat-view.js';
import { draftDisplayRows } from './smart-draft.js';
import { clearActiveSmartDraft, createSmartDraftState, setActiveSmartDraft, takeActiveSmartDraft } from './smart-draft-state.js';
import { WRITING_TEMPLATE_FIELDS, applyWritingTemplateUpdate, buildWritingTemplateGenerationMessages, formatWritingTemplateForTool, loadWritingTemplate, parseWritingTemplateDraft, saveWritingTemplate, writingTemplateKey } from './writing-template.js';
import { streamFetch, streamSSE } from './ai/transport.js';
import { createSafeToolExecutor, createToolExecutor } from './ai/tools/executor.js';
import { WORLD_BOOK_MUTATION_TOOL_NAMES, createWorldBookMutationHandlers } from './ai/tools/worldbook-mutation.js';
import { createSmartDraftOrchestrator } from './ai/tools/smart-draft.js';
import { createWebSearchTool } from './ai/tools/web-search.js';
import { createBookToolHandlers } from './ai/tools/book-tools.js';
import { createAuxiliaryCompletionClient } from './ai/auxiliary-client.js';
import { runWorldBookCommand } from './domain/command-runtime.js';
import { getTools } from './ai/tools/definitions.js';
import { countMessagesTokens, trimToBudget } from './ai/conversation/budget.js';
import { runConversationTurn } from './ai/conversation/engine.js';
import { consumeAssistantStream } from './ai/conversation/stream-adapter.js';
import { addSessionTokens, createSession as makeSession, emptyMemory, enforceMemoryLimits, normalizeMemory, normalizeSessionList, pruneSessions, recentMemoryTurns, selectActiveSession, titleFromMessages, updateSessionFromChat, visibleMessagesFromSession } from './ai/session/model.js';
import { createAiDataRepository } from './ai/session/repository.js';
import { createLegacyAiDataMigration } from './ai/session/migration.js';
import { MEMORY_INJECTION_MAX, MEMORY_INJECTION_TIGHT, ROLLUP_EVERY, applyRollup, buildMemoryInjection as buildMemoryInjectionFromState, createTurnMemoryRecord, planRollup } from './ai/memory/policy.js';
import { createAssistantStreamView } from './ai/ui/assistant-stream-view.js';
import { createChatRenderer } from './ai/ui/chat-renderer.js';
import { createChatComposer } from './ai/ui/chat-composer.js';
import { createMessageActionsView } from './ai/ui/message-actions-view.js';
import { searchEntries, getEntry, listEntries, findDuplicates, checkEntries, testTriggers } from './ai/tools/worldbook-read.js';

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

// ===== 会话/记忆持久化：后端 SQLite（容量不受 localStorage 限制），localStorage 仅作一次性迁移源 =====
// 网络、鉴权与串行 PUT 由 repository 层负责；chat.js 只保留兼容调用名。
const aiDataRepository = createAiDataRepository({
  fetchImpl: (...args) => fetch(...args),
  getAuthHeaders: async () => {
    const { authHeaders } = await import('./auth.js');
    return authHeaders();
  },
  onWriteError: (error, bookId) => {
    console.warn('[WBE] 持久化失败（book ' + bookId + '）:', error.message);
  }
});
function persistPut(bookId, payload) {
  return aiDataRepository.write(bookId, payload);
}

function reportLegacyMigrationWarning(code, error, meta = {}) {
  if (code === 'session_remote_load_failed') {
    console.warn('[WBE] 会话历史加载失败:', error.message);
  } else if (code === 'sessions_local_corrupt') {
    console.warn('[WBE] 会话历史数据损坏，已重置:', meta.key, error);
  } else if (code === 'legacy_chat_corrupt') {
    console.warn('[WBE] 旧版会话历史损坏，跳过迁移:', error.message);
  } else if (code === 'memory_remote_migration_failed') {
    console.warn('[WBE] 书级记忆迁移(后端)失败:', error.message);
  } else if (code === 'memory_local_migration_failed') {
    console.warn('[WBE] 书级记忆迁移(localStorage)失败:', error.message);
  } else if (code === 'corrupt_backup_failed') {
    console.warn('[WBE] 备份损坏数据失败:', meta.key, error);
  }
}

const legacyAiDataMigration = createLegacyAiDataMigration({
  storage: localStorage,
  repository: aiDataRepository,
  makeSession,
  titleFromMessages,
  normalizeMemory,
  emptyMemory,
  onWarning: reportLegacyMigrationWarning,
  onCorruptSessions: () => {
    import('./utils.js').then(m => m.showToast('会话历史数据损坏，已备份并重置', 'error'));
  }
});

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
let sessions = [];          // 当前书的会话列表
let activeSessionId = null; // 活动会话 id

// 累计本会话的发送 token（持久化在 session 对象，随 saveChatHistory 落库）
function accumulateSessionTokens() {
  const cur = sessions.find(s => s.id === activeSessionId);
  addSessionTokens(cur, lastTokensTotal);
}

async function loadChatHistory(bookId) {
  const seed = await legacyAiDataMigration.loadSessionSeed(bookId);
  sessions = normalizeSessionList(seed.sessions);
  const target = selectActiveSession(sessions, seed.activeSession);
  activeSessionId = target ? target.id : null;
  chatMessages.length = 0;
  if (target) {
    chatMessages.push(...visibleMessagesFromSession(target));
    // 会话级记忆：若该会话还没有记忆，迁移旧的「书级记忆」到该会话。
    if (!target.memory) {
      target.memory = await legacyAiDataMigration.migrateLegacyMemory(bookId);
    }
    memory = normalizeMemory(target.memory);
  } else {
    memory = emptyMemory();
  }
  updateMemoryBadge();
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
  const record = createTurnMemoryRecord({ user, trace, reply, actionSummary, toolSummary });
  if (!record) return;
  memory.turns.push(record);
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
// 附属 AI 请求（标题生成/记忆总结/正文补全/模板生成）统一走独立 completion client。
const auxiliaryCompletionClient = createAuxiliaryCompletionClient({
  getConfig: () => ({
    apiUrl: localStorage.getItem('wbe-api-url'),
    apiKey: localStorage.getItem('wbe-api-key'),
    model: localStorage.getItem('wbe-model') || 'gpt-4o'
  })
});
function completeAuxiliary(messages, opts = {}) {
  return auxiliaryCompletionClient.complete(messages, opts);
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
    const text = await completeAuxiliary([
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
  const plan = planRollup(memory, ROLLUP_EVERY);
  if (!plan) return;
  isRollingUp = true;
  updateMemoryBadge();
  if ($('memoryModal') && $('memoryModal').classList.contains('open')) renderMemoryList();

  try {
    const text = await completeAuxiliary(plan.messages);
    if (applyRollup(memory, plan, text)) saveMemory();
  } catch (e) {
    console.warn('[WBE] 记忆整合失败，下回合重试:', e.message);
  } finally {
    isRollingUp = false;
    updateMemoryBadge();
    if ($('memoryModal') && $('memoryModal').classList.contains('open')) renderMemoryList();
  }
}

// 注入 system：所有大总结全文 + 最近未压缩的小总结（总长上限 8000 字符，防止上下文膨胀）

function buildMemoryInjection(maxChars = MEMORY_INJECTION_MAX) {
  return buildMemoryInjectionFromState(memory, maxChars);
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
    const text = await completeAuxiliary(buildWritingTemplateGenerationMessages({ bookName: curBookName, samples }), { model, apiUrl, apiKey });
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
let chatComposer = null;

export function initChat() {
  const $btnSendChat = $('btn-send-chat');
  const $chatInput = $('chat-input');
  const $clear = $('chatClearBtn');
  const scroller = getChatScroller();
  const $toBottom = $('chatToBottom');

  if (chatComposer) chatComposer.dispose();
  chatComposer = createChatComposer({
    sendButton: $btnSendChat,
    input: $chatInput,
    scroller,
    toBottomButton: $toBottom,
    getIsSending: () => isSending,
    onSend: () => sendChat(),
    onStop: () => abortActiveChat('user'),
    onScroll: updateToBottomBtn,
    onToBottom: scrollChatToBottom
  });
  chatComposer.bind();

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

const messageActionsView = createMessageActionsView({
  documentRef: document,
  getMessages: () => chatMessages,
  getTokenBudget: () => TOKEN_BUDGET,
  onResend: () => resendLast(),
  onCopy: i => copyMsgText(i),
  onEdit: (i, msgEl) => startEditMsg(msgEl, i),
  onDelete: (i, msgEl) => deleteMsg(i, msgEl)
});

function attachMsgRow(msgEl, idx) {
  return messageActionsView.attach(msgEl, idx);
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
const assistantStreamView = createAssistantStreamView();

async function streamDisplay(response, msgEl) {
  return consumeAssistantStream(streamSSE(response), {
    extractReasoning: extractReasoningDelta,
    onUpdate: ({ content, reasoning }) => {
      renderAssistantStream(msgEl, content, reasoning, true);
      if (isChatNearBottom()) scrollChatToBottom();
    },
    onComplete: ({ content, reasoning }) => {
      collapseReasoningAfterStream(msgEl, reasoning);
      // 冲刷最后一帧：rAF 节流下最后一帧可能仍在排队，这里同步补一帧收尾。
      renderAssistantStream(msgEl, content, reasoning, false);
    }
  });
}

function collapseReasoningAfterStream(msgEl, reasoning) {
  assistantStreamView.collapse(msgEl, reasoning);
}

function renderAssistantStream(msgEl, content, reasoning, reasoningOpen = false) {
  assistantStreamView.render(msgEl, content, reasoning, reasoningOpen);
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

// ===== Chat DOM renderer =====
const chatRenderer = createChatRenderer({
  documentRef: document,
  getContainer: () => $('chat-messages'),
  getMessageCount: () => chatMessages.length,
  attachAssistantActions: (el, idx) => attachResendBtn(el, idx),
  attachUserActions: (el, idx) => attachMsgActions(el, idx),
  applyVisibleLimit: applyChatVisibleLimit,
  isNearBottom: isChatNearBottom,
  scrollToBottom: scrollChatToBottom,
  onOpenEntry: uid => {
    selectEntry(uid);
    document.dispatchEvent(new CustomEvent('wbe:goto-editor'));
  },
  onUndoTurn: base => undoThisTurn(base),
  getTurnUndoBase: () => turnUndoBase
});

function createAssistantBubble() {
  return chatRenderer.createAssistantBubble();
}

// ===== 发送按钮忙碌态 =====
let isSending = false;
function setSendBusy(busy) {
  isSending = !!busy;
  if (chatComposer) chatComposer.setBusy(isSending);
}

// ===== sendChat =====
const MAX_ROUNDS = 12;              // 工具调用轮数上限（原 25，平方级膨胀，降到 12 控制上下文）
const STREAM_TIMEOUT_MS = 120000;   // 主对话流式请求超时（超时自动 abort 并复位 UI）
const TOKEN_BUDGET = 16000;         // 每轮请求上下文 token 预算（超预算两档降级）
let lastTokensTotal = 0;            // 最近一轮实际发送的上下文估算（写入 assistant 消息，按钮行显示）

// 单个工具执行异常隔离：出错时把错误消息作为结果返回给模型，继续后续工具
const MUTATING_TOOL_NAMES = new Set([
  ...WORLD_BOOK_MUTATION_TOOL_NAMES,
  'create_smart_entry'
]);

let dispatchTool = null;
const safeExecuteTool = createSafeToolExecutor({
  executeTool: (name, args) => dispatchTool(name, args),
  isMutating: name => MUTATING_TOOL_NAMES.has(name),
  beforeMutation: () => {
    // Turn-level rollback is separate from per-command undo. Read-only tools never snapshot.
    if (turnUndoBase === -1) {
      snapshotForUndo('AI 回合开始');
      turnUndoBase = undoStackLength();
    }
  },
  onError: (error, name) => console.warn('[WBE] 工具执行异常:', name, error)
});

async function sendChat(prevText) {
  if (isSending) return; // 防止重复发送
  const input = $('chat-input');
  const text = prevText != null ? prevText : (input ? input.value.trim() : '');
  if (!text) return;
  if (prevText == null) {
    input.value = '';
    if (chatComposer) chatComposer.resetInputHeight(); // 复位自动高度由 composer 管理
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
  return chatRenderer.appendMessage(role, text, idx);
}

// ===== 本轮改动卡片：回合内条目级改动汇总，可点条目跳转、一键撤销本轮 =====
let turnUndoBase = 0; // sendChat 开始时撤销栈深度（一键撤销恢复到该点）

function appendChangesCard(changes) {
  return chatRenderer.appendChangesCard(changes);
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

const mutationToolHandlers = createWorldBookMutationHandlers({
  getEntries: getAllEntries,
  getCurrentUid: () => currentUid,
  nextUid,
  createEntry,
  runCommand: runWorldBookCommand,
  renderSidebar,
  renderEditor,
  renderEditorEmpty,
  selectEntry,
  clearCurrentUid: () => import('./state.js').then(m => m.setCurrentUid(null)),
  scheduleSave
});

const webSearchTool = createWebSearchTool({
  fetchImpl: (...args) => fetch(...args),
  getAuthHeaders: async () => {
    const { authHeaders } = await import('./auth.js');
    return authHeaders();
  }
});

const bookToolHandlers = createBookToolHandlers({
  getEntries: getAllEntries,
  getCurrentBookId: () => currentBookId,
  getCurrentBookName: currentBookName,
  getCurrentBookData: () => worldBook,
  getOpenEntryCount: () => entries.length,
  listBooks: loadBookList,
  openBook: id => loadBook(id, renderSidebar, selectEntry, renderEditorEmpty),
  createBook,
  renameBook,
  deleteBook,
  fetchBook: async id => {
    const book = await apiRequest('GET', '/api/books/' + id);
    return book.data;
  },
  beforeSwitch: abortActiveChat,
  setCurrentBookName: name => {
    const el = $('file-name');
    if (el) el.textContent = name;
  },
  cleanupDeletedBook: cleanupDeletedBookLocalData,
  onCleanupError: (error, bookId) => console.warn('[WBE] 清理已删世界书的本地数据失败:', bookId, error),
  onDeletedCurrentBook: handleDeletedCurrentBook
});

const smartDraftOrchestrator = createSmartDraftOrchestrator({
  getEntries: getAllEntries,
  getWritingTemplate: () => loadWritingTemplate(localStorage, currentBookId),
  completeAuxiliary,
  nextUid,
  createEntry,
  runCommand: runWorldBookCommand,
  renderSidebar,
  scheduleSave,
  setActiveDraft: record => setActiveSmartDraft(smartDraftState, record),
  showDraftPreview: renderSmartDraftModal,
  onCompletionError: error => console.warn('[WBE] 正文补全失败，保留原草稿:', error.message)
});

dispatchTool = createToolExecutor({
  handlers: {
    search_entries: toolSearch,
    get_entry: toolGet,
    ...mutationToolHandlers,
    get_writing_template: toolGetWritingTemplate,
    update_writing_template: toolUpdateWritingTemplate,
    ...smartDraftOrchestrator.handlers,
    list_entries: toolList,
    check_entries: () => toolCheckEntries(),
    test_triggers: toolTestTriggers,
    export_book: () => toolExportBook(),
    web_search: webSearchTool,
    cleanup_book: () => toolCleanupBook(),
    find_duplicates: toolFindDuplicates,
    undo_last: toolUndo,
    ...bookToolHandlers
  }
});


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
  const result = smartDraftOrchestrator.commitDraft(record.draft);
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

function toolList(args = {}) {
  return listEntries(getAllEntries(), args);
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

function cleanupDeletedBookLocalData(bookId) {
  legacyAiDataMigration.cleanupBookLocalData(bookId);
}

async function handleDeletedCurrentBook({ remainingBooks }) {
  abortActiveChat('switch');
  memory = emptyMemory();
  logBookId = null;
  sessions = [];
  activeSessionId = null;
  updateMemoryBadge();

  let tail = '';
  if (remainingBooks.length) {
    await loadBook(remainingBooks[0].id, renderSidebar, selectEntry, renderEditorEmpty);
    tail = '，已切换到「' + remainingBooks[0].name + '」';
  } else {
    const state = await import('./state.js');
    state.setCurrentBookId(null);
    state.setCurrentUid(null);
    setEntries([]);
    renderSidebar();
    renderEditorEmpty();
    const el = $('file-name');
    if (el) el.textContent = '未命名';
    chatMessages.length = 0;
    renderChatHistory();
    tail = '，已无其它世界书';
  }
  ensureMemoryLoaded();
  return tail;
}
