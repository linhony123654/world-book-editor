import { TOOL_NAMES, TOOL_NAME_PATTERN } from '../../tool-names.js';

// Text-format fallback parser for gateways that do not return native tool_calls.
const TOOL_CALL_JSON_RE = new RegExp('\\{\\s*"name"\\s*:\\s*"(' + TOOL_NAME_PATTERN + ')"\\s*,\\s*"arguments"\\s*:\\s*(\\{[\\s\\S]*?\\})\\s*\\}', 'g');
const TOOL_FN_RE = new RegExp('\\b(' + TOOL_NAME_PATTERN + ')\\s*\\(([^)]*)\\)', 'g');
const TOOL_CALL_JSON_STRIP_RE = new RegExp('\\{\\s*"name"\\s*:\\s*"(' + TOOL_NAME_PATTERN + ')"\\s*,\\s*"arguments"\\s*:\\s*\\{[\\s\\S]*?\\}\\s*\\}', 'g');

// ===== 检测文本是否包含工具调用 =====
export function hasToolCall(text) {
  if (!text) return false;
  if (/<tool_call>/.test(text)) return true;
  if (/<tool_use>/.test(text)) return true;
  if (/<function=/.test(text)) return true;
  return false;
}

// ===== 解析文本格式工具调用 =====
export function parseTextToolCalls(text) {
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
      if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
      else if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (/^[\[{]/.test(val)) {
        // 对象/数组参数保持结构化，避免被字符串化写脏数据
        try {
          const parsed = JSON.parse(val);
          if (parsed !== null && typeof parsed === 'object') val = parsed;
        } catch (e) {}
      }
      args[key] = val;
    }
    results.push({ name, args });
  }
  if (results.length > 0) return results;

  // 3. {"name":"xxx","arguments":{...}} 独立 JSON（名单派生自 TOOL_NAME_PATTERN）
  while ((m = TOOL_CALL_JSON_RE.exec(text)) !== null) {
    try { results.push({ name: m[1], args: JSON.parse(m[2]) }); } catch (e) {}
  }
  if (results.length > 0) return results;

  // 4. search_entries("xxx") 函数调用格式（名单派生自 TOOL_NAME_PATTERN）
  while ((m = TOOL_FN_RE.exec(text)) !== null) {
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
export function stripToolCalls(text) {
  if (!text) return text;
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  text = text.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '');
  text = text.replace(/<function=\w+>[\s\S]*?<\/function>/g, '');
  text = text.replace(TOOL_CALL_JSON_STRIP_RE, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}
