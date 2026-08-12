import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultWritingTemplate,
  formatWritingTemplateForTool,
  buildWritingTemplateGenerationMessages,
  loadWritingTemplate,
  parseWritingTemplateDraft,
  applyWritingTemplateUpdate,
  saveWritingTemplate,
  selectWritingTemplate,
  writingTemplateKey
} from '../modules/writing-template.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
}

test('builds per-book writing template storage key', () => {
  assert.equal(writingTemplateKey(23), 'wbe-writing-template:23');
  assert.equal(writingTemplateKey(null), 'wbe-writing-template:unsaved');
});

test('saves and loads normalized writing templates per book', () => {
  const storage = memoryStorage();
  saveWritingTemplate(storage, 7, {
    general: '不要空框架。',
    location: '入口伪装：写入口\n隐藏风险：写风险',
    unknown: 'ignored'
  });

  const template = loadWritingTemplate(storage, 7);

  assert.equal(template.general, '不要空框架。');
  assert.equal(template.location, '入口伪装：写入口\n隐藏风险：写风险');
  assert.equal(template.character, '');
  assert.equal(template.unknown, undefined);
});

test('selects general plus semantic and function specific template text', () => {
  const template = createDefaultWritingTemplate({
    general: '所有条目写具体。',
    location: '位置与功能：写用途。',
    plot_hook: '剧情钩子：写可触发冲突。',
    rule: '规则：写限制。'
  });

  const selected = selectWritingTemplate(template, { semanticType: 'location', functionType: 'plot_hook' });

  assert.match(selected, /所有条目写具体/);
  assert.match(selected, /位置与功能/);
  assert.match(selected, /剧情钩子/);
  assert.doesNotMatch(selected, /规则/);
});

test('formats selected template for AI tool output', () => {
  const template = createDefaultWritingTemplate({ general: '用短段落。', character: '身份：写清身份。' });
  const text = formatWritingTemplateForTool(template, { semanticType: 'character' });

  assert.match(text, /通用模板/);
  assert.match(text, /人物模板/);
  assert.match(text, /身份：写清身份/);
});

test('parses AI generated template JSON', () => {
  const parsed = parseWritingTemplateDraft('{"general":"不要空框架","location":"入口伪装：写入口"}');

  assert.equal(parsed.general, '不要空框架');
  assert.equal(parsed.location, '入口伪装：写入口');
  assert.equal(parsed.character, '');
});

test('parses fenced AI generated template JSON', () => {
  const parsed = parseWritingTemplateDraft('```json\n{"general":"写具体","rule":"规则：写限制"}\n```');

  assert.equal(parsed.general, '写具体');
  assert.equal(parsed.rule, '规则：写限制');
});

test('parses AI generated template text sections', () => {
  const parsed = parseWritingTemplateDraft([
    '通用模板：',
    '所有条目必须写具体。',
    '人物模板：',
    '身份：写清身份。',
    '剧情钩子模板：',
    '触发：给出冲突。'
  ].join('\n'));

  assert.equal(parsed.general, '所有条目必须写具体。');
  assert.equal(parsed.character, '身份：写清身份。');
  assert.equal(parsed.plot_hook, '触发：给出冲突。');
});

test('builds generation prompt for placeholder templates instead of concrete lore', () => {
  const messages = buildWritingTemplateGenerationMessages({
    bookName: '女权世界',
    samples: '#1 王都\n这里是旧条目正文。'
  });
  const combined = messages.map(m => m.content).join('\n');

  assert.match(combined, /占位模板/);
  assert.match(combined, /根据用户输入/);
  assert.match(combined, /不要把条目样本改写成正文/);
  assert.match(combined, /世界观核心：根据用户输入/);
});

test('applies partial writing template updates without clearing other tabs', () => {
  const current = createDefaultWritingTemplate({
    general: '旧通用模板',
    location: '旧地点模板',
    character: '旧人物模板'
  });

  const updated = applyWritingTemplateUpdate(current, {
    location: '新地点模板',
    plot_hook: '新剧情钩子模板',
    unknown: 'ignored'
  });

  assert.equal(updated.general, '旧通用模板');
  assert.equal(updated.character, '旧人物模板');
  assert.equal(updated.location, '新地点模板');
  assert.equal(updated.plot_hook, '新剧情钩子模板');
  assert.equal(updated.unknown, undefined);
});

test('appends writing template updates when requested', () => {
  const current = createDefaultWritingTemplate({ location: '位置与功能：根据用户输入写用途。' });

  const updated = applyWritingTemplateUpdate(current, {
    location: '隐藏风险：根据用户输入写追查风险。'
  }, { mode: 'append' });

  assert.match(updated.location, /位置与功能/);
  assert.match(updated.location, /隐藏风险/);
});
