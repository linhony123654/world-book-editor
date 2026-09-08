import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiProfileRepository } from '../public/modules/app/api-profiles.js';
import { apiStatusText, createApiSettingsController, normalizeModelsResponse } from '../public/modules/app/api-settings.js';

function makeStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

function element(initial = {}) {
  const listeners = new Map();
  const classes = new Set();
  return {
    value: '',
    innerHTML: '',
    textContent: '',
    className: '',
    dataset: {},
    disabled: false,
    style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        if (force === undefined) force = !classes.has(name);
        if (force) classes.add(name); else classes.delete(name);
        return force;
      },
      contains(name) { return classes.has(name); }
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) {
      const handler = listeners.get(type);
      return handler?.({ target: this, ...event });
    },
    click() { return this.emit('click'); },
    focus() {},
    select() {},
    ...initial
  };
}

function makeHarness({ profiles, activeId = '', fetchImpl } = {}) {
  const elements = {
    apiProfileSelectModal: element(),
    apiNameInput: element(),
    apiUrlInput: element(),
    apiKeyInput: element(),
    apiModelSelect: element(),
    apiPromptInput: element(),
    modelStatus: element(),
    apiModal: element(),
    fetchModelsBtn: element(),
    newProfileBtn: element(),
    deleteProfileBtn: element(),
    saveApiBtn: element(),
    jbUndoRow: element(),
    jbUndoTip: element(),
    jbUndoBtn: element(),
    openApiBtn: element(),
    apiConfigRow: element(),
    apiProfileSelect: element()
  };
  const storage = makeStorage({
    'wbe-api-profiles': JSON.stringify(profiles || []),
    ...(activeId ? { 'wbe-api-active': activeId } : {})
  });
  const repo = createApiProfileRepository({ storage });
  const toasts = [];
  const fetchCalls = [];
  const controller = createApiSettingsController({
    $: id => elements[id] || null,
    escHtml: value => String(value),
    escAttr: value => String(value),
    showToast: (...args) => toasts.push(args),
    openModal() {},
    closeModal() {},
    authHeaders: () => ({ Authorization: 'Bearer test' }),
    fetchImpl: fetchImpl || (async (...args) => {
      fetchCalls.push(args);
      return { ok: true, json: async () => ({ data: [] }) };
    }),
    profileRepo: repo,
    defaultSystemPrompt: 'DEFAULT',
    refreshSettings() {},
    now: () => 42,
    setTimeoutImpl: fn => fn(),
    presets: []
  });
  return { controller, elements, repo, storage, toasts, fetchCalls };
}

test('normalizeModelsResponse accepts OpenAI data envelope and sorts object/string ids', () => {
  assert.deepEqual(normalizeModelsResponse({ data: [{ id: 'z' }, 'a', { id: 'm' }, null] }), ['a', 'm', 'z']);
  assert.deepEqual(normalizeModelsResponse(['b', { id: 'a' }]), ['a', 'b']);
  assert.deepEqual(normalizeModelsResponse({ nope: true }), []);
});

test('apiStatusText preserves connected and unconfigured labels', () => {
  assert.equal(apiStatusText({ url: 'https://api', model: 'model-x' }), '已连接 · model-x');
  assert.equal(apiStatusText({ url: 'https://api', model: '' }), '未配置 · 点击设置 API / 模型');
  assert.equal(apiStatusText(null), '未配置 · 点击设置 API / 模型');
});

test('openApiModal loads active profile fields and keeps stored prompt over default', () => {
  const profile = { id: 'a', name: 'Primary', url: 'https://api', key: 'key', model: 'm1', prompt: 'CUSTOM' };
  const { controller, elements } = makeHarness({ profiles: [profile], activeId: 'a' });
  controller.openApiModal();
  assert.equal(elements.apiNameInput.value, 'Primary');
  assert.equal(elements.apiUrlInput.value, 'https://api');
  assert.equal(elements.apiKeyInput.value, 'key');
  assert.equal(elements.apiPromptInput.value, 'CUSTOM');
  assert.equal(elements.apiModelSelect.dataset.current, 'm1');
  assert.equal(controller.getEditingProfileId(), 'a');
});

test('fillModalFields uses default system prompt for new profile', () => {
  const { controller, elements } = makeHarness();
  controller.fillModalFields(null);
  assert.equal(elements.apiPromptInput.value, 'DEFAULT');
  assert.match(elements.apiModelSelect.innerHTML, /先拉取模型列表/);
});

test('fetchModels preserves proxy request contract and selects first model when none is current', async () => {
  const calls = [];
  const { controller, elements } = makeHarness({
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, json: async () => ({ data: [{ id: 'zeta' }, { id: 'alpha' }] }) };
    }
  });
  elements.apiUrlInput.value = 'https://third-party/v1';
  elements.apiKeyInput.value = 'secret';
  const models = await controller.fetchModels();
  assert.deepEqual(models, ['alpha', 'zeta']);
  assert.equal(calls[0][0], '/api/proxy/models');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test');
  assert.equal(calls[0][1].body, JSON.stringify({ url: 'https://third-party/v1', key: 'secret' }));
  assert.equal(elements.apiModelSelect.value, 'alpha');
  assert.equal(elements.modelStatus.className, 'model-status success');
});

test('saveApiBtn creates profile, persists it, and activates legacy mirrors through repository', () => {
  const { controller, elements, repo, storage } = makeHarness();
  controller.bindApiModal();
  elements.apiNameInput.value = 'New';
  elements.apiUrlInput.value = 'https://new';
  elements.apiKeyInput.value = 'k';
  elements.apiModelSelect.value = 'm';
  elements.apiPromptInput.value = 'p';
  elements.saveApiBtn.click();

  assert.deepEqual(repo.load(), [{ id: 'p42', name: 'New', url: 'https://new', key: 'k', model: 'm', prompt: 'p' }]);
  assert.equal(repo.activeId(), 'p42');
  assert.equal(storage.getItem('wbe-api-url'), 'https://new');
  assert.equal(storage.getItem('wbe-model'), 'm');
});

test('deleteProfileBtn clears active state when deleting the last profile', () => {
  const profile = { id: 'a', name: 'Only', url: 'https://api', key: 'k', model: 'm', prompt: 'p' };
  const { controller, elements, repo, storage } = makeHarness({ profiles: [profile], activeId: 'a' });
  controller.openApiModal();
  controller.bindApiModal();
  elements.deleteProfileBtn.click();
  assert.deepEqual(repo.load(), []);
  assert.equal(repo.activeId(), '');
  assert.equal(storage.getItem('wbe-api-url'), '');
  assert.equal(controller.getEditingProfileId(), null);
});
