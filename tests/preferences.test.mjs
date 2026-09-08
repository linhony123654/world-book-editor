import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreferencesController, formatUsageLabel, normalizeTheme, themePresentation } from '../public/modules/app/preferences.js';

function makeStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    dump() { return Object.fromEntries(data); }
  };
}

function element(initial = {}) {
  const classes = new Set(initial.classes || []);
  const listeners = new Map();
  const attrs = new Map();
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    hidden: false,
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        if (force === undefined) force = !classes.has(name);
        if (force) classes.add(name); else classes.delete(name);
        return force;
      }
    },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type) { return listeners.get(type)?.({ target: this }); },
    ...initial
  };
}

function makeHarness({ storageSeed, profiles = [], activeId = '', usage } = {}) {
  const elements = {
    themeSwitch: element(),
    themeLabel: element(),
    autoSaveSwitch: element(),
    apiStatusLabel: element(),
    apiProfileSelect: element(),
    usageStatsRow: element(),
    usageStatsLabel: element(),
    chatVisibleLimitInput: element()
  };
  const tabs = [element({ dataset: { settab: 'pref' } }), element({ dataset: { settab: 'ai' } })];
  const panes = [element({ dataset: { pane: 'pref' } }), element({ dataset: { pane: 'ai' } })];
  const themeMeta = element();
  const root = element();
  const documentRef = {
    documentElement: root,
    querySelectorAll(selector) {
      if (selector === '.settings-tabs .tab') return tabs;
      if (selector === '.settings-pane') return panes;
      return [];
    },
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') return themeMeta;
      return null;
    }
  };
  const storage = makeStorage(storageSeed);
  const profileRepo = {
    load: () => profiles,
    activeId: () => activeId,
    get: id => profiles.find(p => p.id === id) || null
  };
  const toasts = [];
  let appliedLimit = 0;
  let savedLimit = null;
  const controller = createPreferencesController({
    $: id => elements[id] || null,
    documentRef,
    storage,
    profileRepo,
    escHtml: value => String(value),
    escAttr: value => String(value),
    apiStatusText: profile => profile?.model ? '已连接 · ' + profile.model : '未配置',
    readChatVisibleLimit: () => 25,
    saveChatVisibleLimit: value => { savedLimit = Number(value); return savedLimit; },
    applyChatVisibleLimit: () => { appliedLimit += 1; },
    getChatUsage: async () => usage ?? { sessions: 0, tokens: 0, withStats: 0 },
    showToast: (...args) => toasts.push(args)
  });
  return { controller, elements, tabs, panes, themeMeta, root, storage, toasts, getAppliedLimit: () => appliedLimit, getSavedLimit: () => savedLimit };
}

test('theme normalization and presentation preserve current light/dark contract', () => {
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('anything'), 'light');
  assert.deepEqual(themePresentation('dark'), {
    theme: 'dark', label: '夜墨模式 · 深色背景', themeColor: '#11110f', switchOff: true
  });
  assert.deepEqual(themePresentation('light'), {
    theme: 'light', label: '暖纸张、墨色正文与酒红强调', themeColor: '#f3efe7', switchOff: false
  });
});

test('usage label preserves sessions, tokens and old-session suffix semantics', () => {
  assert.equal(formatUsageLabel({ sessions: 0, tokens: 10, withStats: 0 }), '');
  assert.equal(formatUsageLabel({ sessions: 2, tokens: 1234, withStats: 2 }), '2 个会话 · 累计发送 ≈ 1,234 tok');
  assert.equal(formatUsageLabel({ sessions: 3, tokens: 50, withStats: 2 }), '3 个会话 · 累计发送 ≈ 50 tok（旧会话未计入）');
});

test('applyTheme updates root attribute, switch aria, label and browser theme color', () => {
  const { controller, elements, root, themeMeta } = makeHarness();
  assert.equal(controller.applyTheme('dark'), 'dark');
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(elements.themeSwitch.classList.contains('off'), true);
  assert.equal(elements.themeSwitch.getAttribute('aria-checked'), 'false');
  assert.equal(elements.themeLabel.textContent, '夜墨模式 · 深色背景');
  assert.equal(themeMeta.getAttribute('content'), '#11110f');
});

test('theme click toggles from saved dark state and persists light', () => {
  const { controller, elements, root, storage } = makeHarness({ storageSeed: { 'wbe-theme': 'dark' } });
  controller.initTheme();
  assert.equal(root.getAttribute('data-theme'), 'dark');
  elements.themeSwitch.emit('click');
  assert.equal(root.getAttribute('data-theme'), 'light');
  assert.equal(storage.getItem('wbe-theme'), 'light');
});

test('autosave switch preserves off storage semantics, aria state and toast', () => {
  const { controller, elements, storage, toasts } = makeHarness({ storageSeed: { 'wbe-autosave': 'off' } });
  controller.initAutoSaveSwitch();
  assert.equal(elements.autoSaveSwitch.classList.contains('off'), true);
  assert.equal(elements.autoSaveSwitch.getAttribute('aria-checked'), 'false');
  elements.autoSaveSwitch.emit('click');
  assert.equal(storage.getItem('wbe-autosave'), 'on');
  assert.equal(elements.autoSaveSwitch.getAttribute('aria-checked'), 'true');
  assert.deepEqual(toasts.at(-1), ['已开启自动保存', 'success']);
});

test('settings tabs switch active tab and pane visibility', () => {
  const { controller, tabs, panes } = makeHarness();
  controller.setSettingsTab('ai');
  assert.equal(tabs[0].classList.contains('active'), false);
  assert.equal(tabs[1].classList.contains('active'), true);
  assert.equal(panes[0].hidden, true);
  assert.equal(panes[1].hidden, false);
});

test('chat visible limit change saves, reapplies, normalizes input and preserves toast text', () => {
  const { controller, elements, toasts, getAppliedLimit, getSavedLimit } = makeHarness();
  controller.bindChatVisibleLimit();
  elements.chatVisibleLimitInput.value = '20';
  elements.chatVisibleLimitInput.emit('change');
  assert.equal(getSavedLimit(), 20);
  assert.equal(getAppliedLimit(), 1);
  assert.equal(elements.chatVisibleLimitInput.value, '20');
  assert.deepEqual(toasts.at(-1), ['会话显示最近 20 条', 'success']);
});

test('refreshSettings renders profile status/select, autosave, usage and visible limit', async () => {
  const profiles = [
    { id: 'a', name: '甲', model: 'm-a' },
    { id: 'b', name: '乙', model: 'm-b' }
  ];
  const { controller, elements } = makeHarness({
    profiles,
    activeId: 'b',
    storageSeed: { 'wbe-autosave': 'off' },
    usage: { sessions: 3, tokens: 2000, withStats: 2 }
  });
  await controller.refreshSettings();
  assert.equal(elements.apiStatusLabel.textContent, '已连接 · m-b');
  assert.equal(elements.apiProfileSelect.style.display, '');
  assert.equal(elements.apiProfileSelect.value, 'b');
  assert.match(elements.apiProfileSelect.innerHTML, /甲/);
  assert.match(elements.apiProfileSelect.innerHTML, /乙/);
  assert.equal(elements.autoSaveSwitch.classList.contains('off'), true);
  assert.equal(elements.usageStatsRow.style.display, '');
  assert.equal(elements.usageStatsLabel.textContent, '3 个会话 · 累计发送 ≈ 2,000 tok（旧会话未计入）');
  assert.equal(elements.chatVisibleLimitInput.value, '25');
});

test('refreshSettings hides profile selector and usage row when empty or usage lookup fails', async () => {
  const { controller, elements } = makeHarness();
  await controller.refreshSettings();
  assert.equal(elements.apiProfileSelect.style.display, 'none');
  assert.equal(elements.usageStatsRow.style.display, 'none');
});
