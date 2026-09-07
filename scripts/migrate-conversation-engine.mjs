import fs from 'node:fs';

const path = 'public/modules/chat.js';
let src = fs.readFileSync(path, 'utf8');

const oldParserImport = "import { parseTextToolCalls, stripToolCalls } from './ai/tools/text-tool-parser.js';\n";
const oldBudgetImport = "import { countMessagesTokens, trimToBudget, truncateToolDetail } from './ai/conversation/budget.js';\n";
const newBudgetImports = "import { countMessagesTokens, trimToBudget } from './ai/conversation/budget.js';\nimport { runConversationTurn } from './ai/conversation/engine.js';\n";

if (!src.includes(oldParserImport)) throw new Error('text-tool parser import marker missing');
if (!src.includes(oldBudgetImport)) throw new Error('budget import marker missing');
src = src.replace(oldParserImport, '');
src = src.replace(oldBudgetImport, newBudgetImports);

const idStart = src.indexOf('function genToolCallId() {');
const idEndMarker = '// 单个工具执行异常隔离：出错时把错误消息作为结果返回给模型，继续后续工具';
if (idStart >= 0) {
  const idEnd = src.indexOf(idEndMarker, idStart);
  if (idEnd < 0) throw new Error('tool call id end marker missing');
  src = src.slice(0, idStart) + src.slice(idEnd);
}

const start = src.indexOf('async function sendChat(prevText) {');
const end = src.indexOf('\nfunction appendChatMessage(role, text, idx) {', start);
if (start < 0 || end < 0) throw new Error('sendChat replacement markers missing');

const replacement = `async function sendChat(prevText) {
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
  const bookCtx = '\\n\\n当前世界书:「' + curBookName + '」，共 ' + entries.length + ' 个条目。如需多步操作（如先搜索再修改），可以连续调用工具，系统会把每步结果返回给你。你也可以用 list_books / switch_book / create_book / rename_book / get_book_info 管理整本世界书。';
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
`;

src = src.slice(0, start) + replacement + src.slice(end);

if (!src.includes("import { runConversationTurn } from './ai/conversation/engine.js';")) {
  throw new Error('conversation engine import not installed');
}
if (src.includes('parseTextToolCalls(result.content')) {
  throw new Error('legacy inline tool loop still present');
}
if ((src.match(/async function sendChat\(prevText\)/g) || []).length !== 1) {
  throw new Error('unexpected sendChat count after migration');
}

fs.writeFileSync(path, src);
console.log('Migrated sendChat to dependency-injected conversation engine');
