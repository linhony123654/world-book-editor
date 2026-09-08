import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConfigKeyPayload, createDataToolsController, parseConfigKeyPayload } from '../public/modules/app/data-tools.js';

function element(initial = {}) {
  const listeners = new Map();
  return {
    value: '',
    files: [],
    clicked: 0,
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ target: this, ...event }); },
    click() { this.clicked += 1; return this.emit('click'); },
    ...initial
  };
}

function makeHarness({ books = [], currentBookId = null, copyResult = true, encrypted = true } = {}) {
  const elements = {
    importBtn: element(),
    'file-input': element(),
    exportBtn: element(),
    exportMdBtn: element(),
    copyConfigKeyBtn: element(),
    importConfigKeyBtn: element(),
    configKeyInput: element(),
    reloadBtn: element()
  };
  const profiles = [{ id: 'a', url: 'https://api', key: 'k' }];
  let active = 'a';
  let replaced = null;
  const profileRepo = {
    load: () => profiles,
    activeId: () => active,
    replaceImported(p, a) {
      replaced = { p, a };
      active = a || p[0]?.id || '';
      return { profiles: p.filter(x => x?.id && x?.url), active: p.find(x => x.id === active) || p[0] || null };
    }
  };
  const prompts = [];
  const promptAnswers = [];
  const toasts = [];
  const calls = { importFile: [], exportFile: 0, exportMarkdown: 0, loadBook: [], memory: 0, refresh: 0, copy: [] };
  const controller = createDataToolsController({
    $: id => elements[id] || null,
    importFile: (...args) => calls.importFile.push(args),
    exportFile: () => { calls.exportFile += 1; },
    exportMarkdown: () => { calls.exportMarkdown += 1; },
    loadBookList: async () => books,
    loadBook: async (...args) => { calls.loadBook.push(args); },
    getCurrentBookId: () => currentBookId,
    renderSidebar() {},
    selectEntry() {},
    renderEditorEmpty() {},
    ensureMemoryLoaded: async () => { calls.memory += 1; },
    profileRepo,
    refreshSettings: async () => { calls.refresh += 1; },
    encryptConfigKey: async (payload, password) => `ENC:${password}:${payload}`,
    decryptConfigKey: async (raw, password) => {
      if (password !== 'pw') throw new Error('bad password');
      return JSON.stringify({ p: [{ id: 'b', url: 'https://b' }], a: 'b' });
    },
    decodeLegacyConfigKey: () => JSON.stringify({ p: [{ id: 'legacy', url: 'https://legacy' }], a: 'legacy' }),
    isEncryptedConfigKey: () => encrypted,
    copyText: async (text, opts) => { calls.copy.push([text, opts]); return copyResult; },
    navigatorRef: { marker: 'nav' },
    documentRef: { marker: 'doc' },
    promptFn: (...args) => { prompts.push(args); return promptAnswers.shift() ?? null; },
    showToast: (...args) => toasts.push(args)
  });
  return { controller, elements, profileRepo, prompts, promptAnswers, toasts, calls, getReplaced: () => replaced };
}

test('config payload preserves profiles, active id and v1 marker', () => {
  const repo = { load: () => [{ id: 'a' }], activeId: () => 'a' };
  assert.deepEqual(JSON.parse(buildConfigKeyPayload(repo)), { p: [{ id: 'a' }], a: 'a', v: 1 });
});

test('parseConfigKeyPayload rejects missing profile arrays', () => {
  assert.deepEqual(parseConfigKeyPayload('{"p":[],"a":""}'), { p: [], a: '' });
  assert.throws(() => parseConfigKeyPayload('{"a":"x"}'), /bad key/);
  assert.throws(() => parseConfigKeyPayload('not json'));
});

test('file transfer binds import/export and always clears file input value', () => {
  const { controller, elements, calls } = makeHarness();
  controller.bindFileTransfer();
  elements.importBtn.click();
  assert.equal(elements['file-input'].clicked, 1);
  const file = { name: 'book.json' };
  elements['file-input'].files = [file];
  elements['file-input'].value = 'chosen';
  elements['file-input'].emit('change');
  assert.equal(calls.importFile.length, 1);
  assert.equal(calls.importFile[0][0], file);
  assert.equal(elements['file-input'].value, '');
  elements.exportBtn.click();
  elements.exportMdBtn.click();
  assert.equal(calls.exportFile, 1);
  assert.equal(calls.exportMarkdown, 1);
});

test('copy config key encrypts payload, uses shared clipboard adapter and reports success', async () => {
  const { controller, promptAnswers, calls, toasts } = makeHarness();
  promptAnswers.push('pw');
  const copied = await controller.copyConfigKey();
  assert.equal(copied, true);
  assert.equal(calls.copy.length, 1);
  assert.match(calls.copy[0][0], /^ENC:pw:/);
  assert.equal(calls.copy[0][1].navigatorRef.marker, 'nav');
  assert.equal(calls.copy[0][1].documentRef.marker, 'doc');
  assert.deepEqual(toasts.at(-1), ['已加密并复制，导入时输入同一密码即可', 'success']);
});

test('copy config key falls back to manual prompt when clipboard adapter cannot copy', async () => {
  const { controller, promptAnswers, prompts, toasts } = makeHarness({ copyResult: false });
  promptAnswers.push('pw');
  const copied = await controller.copyConfigKey();
  assert.equal(copied, false);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1][0], '复制失败，请手动复制以下秘钥：');
  assert.equal(toasts.length, 0);
});

test('encrypted config import asks for password, replaces profiles, refreshes and reports count', async () => {
  const { controller, elements, promptAnswers, calls, toasts, getReplaced } = makeHarness({ encrypted: true });
  elements.configKeyInput.value = 'wbe1:x:y:z';
  promptAnswers.push('pw');
  const result = await controller.importConfigKey();
  assert.equal(result.profiles.length, 1);
  assert.deepEqual(getReplaced(), { p: [{ id: 'b', url: 'https://b' }], a: 'b' });
  assert.equal(calls.refresh, 1);
  assert.deepEqual(toasts.at(-1), ['已导入 1 个接口配置', 'success']);
});

test('legacy config import bypasses password prompt and keeps replacement semantics', async () => {
  const { controller, elements, prompts, getReplaced } = makeHarness({ encrypted: false });
  elements.configKeyInput.value = 'wbe:legacy';
  await controller.importConfigKey();
  assert.equal(prompts.length, 0);
  assert.deepEqual(getReplaced(), { p: [{ id: 'legacy', url: 'https://legacy' }], a: 'legacy' });
});

test('reload selects current book when present, otherwise first book, and reloads memory', async () => {
  const books = [{ id: 1 }, { id: 2 }];
  let harness = makeHarness({ books, currentBookId: 2 });
  let target = await harness.controller.reloadCurrentBook();
  assert.equal(target.id, 2);
  assert.equal(harness.calls.loadBook[0][0], 2);
  assert.equal(harness.calls.memory, 1);

  harness = makeHarness({ books, currentBookId: 99 });
  target = await harness.controller.reloadCurrentBook();
  assert.equal(target.id, 1);
  assert.equal(harness.calls.loadBook[0][0], 1);
});

test('reload with no books preserves error toast and skips memory load', async () => {
  const { controller, calls, toasts } = makeHarness({ books: [] });
  assert.equal(await controller.reloadCurrentBook(), null);
  assert.equal(calls.loadBook.length, 0);
  assert.equal(calls.memory, 0);
  assert.deepEqual(toasts.at(-1), ['没有可加载的世界书', 'error']);
});
