import { estimateTokens } from '../../utils.js';

// Pure conversation budget helpers. No DOM, storage or mutable chat state.
// 估算整组消息的 token 总数（含 tool_calls 的 JSON 序列化）
export function countMessagesTokens(messages) {
  return (messages || []).reduce((s, m) =>
    s + estimateTokens(m && m.content) + estimateTokens(m && m.tool_calls ? JSON.stringify(m.tool_calls) : ''), 0);
}

// 折叠最旧消息直到估算 ≤ 预算。安全规则：
// 带 tool_calls 的 assistant 消息与其后续 tool 结果成对移除，避免破坏 function calling 协议。
export function trimToBudget(messages, budget) {
  const system = messages[0];
  const rest = messages.slice(1);
  let total = countMessagesTokens(messages);
  let folded = 0;
  while (rest.length > 1 && total > budget) {
    const removed = rest.shift();
    if (removed && removed.role === 'assistant' && removed.tool_calls) {
      while (rest.length && rest[0].role === 'tool') rest.shift();
    }
    folded++;
    total = countMessagesTokens([system, ...rest]);
  }
  if (folded > 0) rest.unshift({ role: 'user', content: '（为控制上下文长度，较早的对话已折叠，无需回溯，继续当前任务即可）' });
  return [system, ...rest];
}

// 工具结果 detail 截断：防止全量进 messages 导致上下文平方级膨胀
export function truncateToolDetail(detail, maxLength = 800) {
  const d = String(detail == null ? '' : detail);
  return d.length > maxLength ? d.slice(0, maxLength) + '\n…(结果过长已截断)' : d;
}
