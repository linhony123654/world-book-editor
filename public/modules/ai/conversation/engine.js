import { parseTextToolCalls, stripToolCalls } from '../tools/text-tool-parser.js';
import { truncateToolDetail } from './budget.js';

function defaultToolCallId() {
  return 'call_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function recordToolOutcome(turnTrace, turnChanges, name, result) {
  turnTrace.push(name + ': ' + result.summary);
  if (result.changes && result.changes.length) {
    turnChanges.push(...result.changes.map(change => ({ tool: name, ...change })));
  }
}

/**
 * Run one assistant turn across zero or more tool rounds.
 *
 * This module deliberately owns only protocol orchestration:
 * - request a model round through an injected adapter;
 * - maintain OpenAI native tool-call message pairing;
 * - support textual tool-call fallback gateways;
 * - aggregate tool trace / changes;
 * - stop on preview tools or max rounds.
 *
 * It does NOT know about DOM, session persistence, World Book state, undo,
 * abort UI, memory rollups, or SQLite. Those stay in caller adapters.
 */
export async function runConversationTurn({
  messages,
  maxRounds = 12,
  requestRound,
  executeTool,
  onToolAssistant = async () => {},
  onToolResult = async () => {},
  makeToolCallId = defaultToolCallId
}) {
  if (!Array.isArray(messages)) throw new TypeError('messages must be an array');
  if (typeof requestRound !== 'function') throw new TypeError('requestRound must be a function');
  if (typeof executeTool !== 'function') throw new TypeError('executeTool must be a function');

  const turnTrace = [];
  const turnChanges = [];

  for (let round = 0; round < maxRounds; round++) {
    const packet = await requestRound({ messages, round });
    const result = packet && packet.result ? packet.result : packet;
    const context = packet && packet.result ? packet.context : undefined;
    if (!result || typeof result !== 'object') throw new Error('requestRound returned no result');

    const textToolCalls = parseTextToolCalls(result.content || '');

    if (result.tool_calls && result.tool_calls.length > 0) {
      const aiText = stripToolCalls(result.content || '');
      await onToolAssistant({ mode: 'native', aiText, result, context, round });

      // Clone instead of mutating gateway output. Missing IDs are synthesized so
      // every assistant tool_call has a matching role=tool message.
      const calls = result.tool_calls.map(tc => ({
        ...tc,
        id: tc.id || makeToolCallId(),
        function: tc.function ? { ...tc.function } : { name: '', arguments: '' }
      }));
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: calls });

      for (const tc of calls) {
        const callId = tc.id || makeToolCallId();
        const name = tc.function && tc.function.name ? tc.function.name : '';
        let args;
        try {
          args = JSON.parse((tc.function && tc.function.arguments) || '{}');
        } catch (error) {
          const detail = '工具参数 JSON 解析失败: ' + (error && error.message ? error.message : 'invalid JSON') +
            '（参数原文: ' + String((tc.function && tc.function.arguments) || '').slice(0, 200) + '）。请修正参数格式后重新调用该工具。';
          const failed = { summary: '参数解析失败', detail };
          turnTrace.push(name + ': 参数解析失败');
          await onToolResult({ mode: 'native', name, args: null, result: failed, context, callId, round, parseError: true });
          messages.push({ role: 'tool', tool_call_id: callId, content: truncateToolDetail(detail) });
          continue;
        }

        const toolResult = await executeTool(name, args);
        recordToolOutcome(turnTrace, turnChanges, name, toolResult);
        await onToolResult({ mode: 'native', name, args, result: toolResult, context, callId, round, parseError: false });
        messages.push({ role: 'tool', tool_call_id: callId, content: truncateToolDetail(toolResult.detail) });

        if (toolResult.stop) {
          return {
            status: 'preview-stop',
            mode: 'native',
            previewCall: { name, args },
            turnTrace,
            turnChanges,
            messages,
            rounds: round + 1
          };
        }
      }
      continue;
    }

    if (textToolCalls.length > 0) {
      const aiText = stripToolCalls(result.content || '');
      await onToolAssistant({ mode: 'text', aiText, result, context, round });

      const toolResultsText = [];
      for (const call of textToolCalls) {
        const toolResult = await executeTool(call.name, call.args);
        recordToolOutcome(turnTrace, turnChanges, call.name, toolResult);
        await onToolResult({ mode: 'text', name: call.name, args: call.args, result: toolResult, context, round, parseError: false });
        toolResultsText.push(call.name + ' 结果: ' + toolResult.summary + '\n' + truncateToolDetail(toolResult.detail));

        if (toolResult.stop) {
          return {
            status: 'preview-stop',
            mode: 'text',
            previewCall: { name: call.name, args: call.args },
            turnTrace,
            turnChanges,
            messages,
            rounds: round + 1
          };
        }
      }

      messages.push({ role: 'assistant', content: aiText || result.content || '' });
      messages.push({
        role: 'user',
        content: '工具执行结果:\n' + toolResultsText.join('\n\n') + '\n\n如需更多操作可继续调用工具，否则直接回复用户。'
      });
      continue;
    }

    return {
      status: 'final',
      content: stripToolCalls(result.content) || '(无回复)',
      rawContent: result.content || '',
      reasoning: result.reasoning || '',
      context,
      turnTrace,
      turnChanges,
      messages,
      rounds: round + 1
    };
  }

  return {
    status: 'max-rounds',
    turnTrace,
    turnChanges,
    messages,
    rounds: maxRounds
  };
}
