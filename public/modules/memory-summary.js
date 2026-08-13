import { TOOL_NAME_PATTERN } from './tool-names.js';

const TOOL_NAME_RE = new RegExp('\\b(' + TOOL_NAME_PATTERN + ')\\b', 'g');

export function containsToolCallSyntax(text) {
  if (!text) return false;
  return /<tool_call>|<tool_use>|<function=/.test(text) ||
    /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/.test(text) ||
    /\b\w+\s*\([^)]*\)/.test(text);
}

function cleanTraceLine(line) {
  let text = String(line || '').trim();
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  text = text.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '');
  text = text.replace(/<function=\w+>[\s\S]*?<\/function>/g, '');
  text = text.replace(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, '');
  text = text.replace(TOOL_NAME_RE, '');
  text = text.replace(/^\s*[:：-]+\s*/, '');
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}

export function summarizeToolTraceForMemory(trace) {
  const details = (trace || []).map(cleanTraceLine).filter(Boolean).slice(-6);
  if (!details.length) return '';
  return '完成了 ' + (trace || []).length + ' 项操作：' + details.join('；') + '。';
}
