export function checkTriggerSafety({ key, entries }) {
  const checks = [];
  const keys = Array.isArray(key) ? key.map(k => String(k).trim()).filter(Boolean) : [];
  const existing = new Map();
  for (const e of entries || []) {
    for (const k of e.key || []) existing.set(String(k), e);
  }

  for (const k of keys) {
    if ([...k].length <= 1) {
      checks.push({ level: 'warn', code: 'short_keyword', message: '关键词「' + k + '」过短，容易误触发。' });
    }
    const hit = existing.get(k);
    if (hit) {
      checks.push({ level: 'warn', code: 'duplicate_keyword', message: '关键词「' + k + '」已被 #' + hit.uid + '「' + (hit.comment || '无标题') + '」使用。' });
    }
  }

  if (keys.length === 0) checks.push({ level: 'info', code: 'no_keyword', message: '该条目没有关键词，通常只适合常驻或后续补充触发词。' });
  if (!checks.length) checks.push({ level: 'ok', code: 'trigger_ok', message: '关键词具体度正常，暂未发现明显触发风险。' });
  return checks;
}
