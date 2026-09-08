export const ROLLUP_EVERY = 10;
export const MEMORY_INJECTION_MAX = 8000;
export const MEMORY_INJECTION_TIGHT = 2500;

export function createTurnMemoryRecord({
  user,
  trace,
  reply,
  actionSummary = '',
  toolSummary = '',
  now = Date.now()
} = {}) {
  const cleanReply = String(reply || '').trim();
  if (!actionSummary && (!cleanReply || cleanReply === '(无回复)')) return null;
  return {
    user: String(user || '').slice(0, 200),
    actionSummary: actionSummary || '',
    toolSummary: toolSummary || '',
    toolDetail: (Array.isArray(trace) ? trace : []).slice(-20),
    reply: cleanReply.slice(0, 400),
    ts: Number(now)
  };
}

export function buildMemoryInjection(memory, maxChars = MEMORY_INJECTION_MAX) {
  const value = memory || { turns: [], rollups: [], rolledUpCount: 0 };
  const rollups = Array.isArray(value.rollups) ? value.rollups : [];
  const turns = Array.isArray(value.turns) ? value.turns : [];
  const rolledUpCount = Number.isFinite(value.rolledUpCount) ? value.rolledUpCount : 0;
  const parts = [];

  if (rollups.length) {
    parts.push('【长期记忆 · 阶段总结】\n' + rollups.map(r => '· ' + r.text).join('\n'));
  }

  const recent = turns.slice(rolledUpCount);
  if (recent.length) {
    const lines = recent.map((turn, index) => {
      const seg = [];
      if (turn.actionSummary) seg.push(turn.actionSummary);
      else if (turn.toolSummary) seg.push('完成了相关查询或修改');
      if (turn.reply) seg.push(turn.reply);
      return (index + 1) + '. ' + seg.join(' → ');
    });

    // Preserve legacy behavior: retain the newest detailed operations within a
    // fixed 6500-character detail budget before applying the outer injection cap.
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
  return '\n\n' + (joined.length <= maxChars
    ? joined
    : joined.slice(0, maxChars) + '\n…(记忆注入已截断)');
}

export function needsRollup(memory, rollupEvery = ROLLUP_EVERY) {
  const turns = memory && Array.isArray(memory.turns) ? memory.turns : [];
  const rolledUpCount = memory && Number.isFinite(memory.rolledUpCount) ? memory.rolledUpCount : 0;
  return turns.length - rolledUpCount >= rollupEvery;
}

export function planRollup(memory, rollupEvery = ROLLUP_EVERY) {
  if (!needsRollup(memory, rollupEvery)) return null;

  const from = Number.isFinite(memory.rolledUpCount) ? memory.rolledUpCount : 0;
  const to = from + rollupEvery;
  const batch = memory.turns.slice(from, to);
  const previousDigest = (memory.rollups || []).map(r => r.text).join('\n');
  const lines = batch.map((turn, index) => {
    const parts = [];
    if (turn.user) parts.push('用户：' + turn.user);
    if (turn.actionSummary) parts.push('操作：' + turn.actionSummary);
    else if (turn.toolSummary) parts.push('操作：完成了相关查询或修改');
    if (turn.reply) parts.push('结果：' + turn.reply);
    return (index + 1) + '. ' + parts.join('；');
  }).join('\n');

  const system = '你是记忆整合器。把用户与世界书编辑助手的若干回合操作记录浓缩成一段简洁的中文阶段总结，' +
    '保留关键的新增/修改/删除的条目名与结论，去掉重复与搜索噪声，不要逐条复述，控制在 150 字内。';
  const user = (previousDigest
    ? '已有阶段总结（供衔接，不要重复其内容）：\n' + previousDigest + '\n\n'
    : '') +
    '需要整合的 ' + rollupEvery + ' 个回合：\n' + lines;

  return {
    from,
    to,
    batch,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
}

export function applyRollup(memory, plan, text) {
  const clean = String(text || '').trim();
  if (!memory || !plan || !clean) return false;
  if (!Array.isArray(memory.rollups)) memory.rollups = [];
  memory.rollups.push({ from: plan.from, to: plan.to, text: clean });
  memory.rolledUpCount = plan.to;
  return true;
}
