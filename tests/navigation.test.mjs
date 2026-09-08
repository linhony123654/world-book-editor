import assert from 'node:assert/strict';
import test from 'node:test';

import { APP_SCREENS, createNavigationController } from '../public/modules/app/navigation.js';

function element(initial = {}) {
  const listeners = new Map();
  const toggles = [];
  return {
    dataset: {},
    classList: { toggle(name, value) { toggles.push([name, value]); } },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ target: this, ...event }); },
    click() { return this.emit('click'); },
    toggles,
    ...initial
  };
}

function makeHarness({ withApp = true } = {}) {
  const screens = Object.fromEntries(APP_SCREENS.map(name => ['screen-' + name, element()]));
  const navLibrary = element({ dataset: { nav: 'library' } });
  const navChat = element({ dataset: { nav: 'chat' } });
  const goEditor = element({ dataset: { go: 'editor' } });
  const app = withApp ? { scrollTop: 123, scrollHeight: 987 } : null;
  const calls = { archive: 0, refresh: 0, tabs: [], profile: 0, title: 0, windowScroll: [] };

  const documentRef = {
    querySelector(selector) { return selector === '.app' ? app : null; },
    querySelectorAll(selector) {
      if (selector === '.bottom-nav .nav') return [navLibrary, navChat];
      if (selector === '[data-nav]') return [navLibrary, navChat];
      if (selector === '[data-go]') return [goEditor];
      return [];
    }
  };

  const controller = createNavigationController({
    $: id => screens[id] || null,
    documentRef,
    windowRef: { scrollTo: (...args) => calls.windowScroll.push(args) },
    renderArchives: () => { calls.archive += 1; },
    refreshSettings: () => { calls.refresh += 1; },
    setSettingsTab: tab => calls.tabs.push(tab),
    fillProfile: () => { calls.profile += 1; },
    autoSizeTitle: () => { calls.title += 1; }
  });

  return { controller, screens, navLibrary, navChat, goEditor, app, calls };
}

test('invalid screen is ignored without mutating navigation state', () => {
  const h = makeHarness();
  assert.equal(h.controller.setScreen('missing'), false);
  assert.equal(h.screens['screen-library'].toggles.length, 0);
  assert.equal(h.navLibrary.toggles.length, 0);
});

test('setScreen toggles all screen containers and bottom-nav active state', () => {
  const h = makeHarness();
  assert.equal(h.controller.setScreen('chat'), true);
  assert.deepEqual(h.screens['screen-chat'].toggles.at(-1), ['active', true]);
  assert.deepEqual(h.screens['screen-library'].toggles.at(-1), ['active', false]);
  assert.deepEqual(h.navChat.toggles.at(-1), ['active', true]);
  assert.deepEqual(h.navLibrary.toggles.at(-1), ['active', false]);
});

test('chat scrolls app to bottom while other screens reset app scrollTop', () => {
  const h = makeHarness();
  h.controller.setScreen('chat');
  assert.equal(h.app.scrollTop, 987);
  h.controller.setScreen('library');
  assert.equal(h.app.scrollTop, 0);
  assert.deepEqual(h.calls.windowScroll, []);
});

test('missing app scroller falls back to window scrollTo', () => {
  const h = makeHarness({ withApp: false });
  h.controller.setScreen('library');
  assert.deepEqual(h.calls.windowScroll, [[0, 0]]);
});

test('screen lifecycle hooks preserve archives/settings/me/editor behavior', () => {
  const h = makeHarness();
  h.controller.setScreen('archives');
  h.controller.setScreen('settings');
  h.controller.setScreen('me');
  h.controller.setScreen('editor');
  assert.equal(h.calls.archive, 1);
  assert.equal(h.calls.refresh, 1);
  assert.deepEqual(h.calls.tabs, ['pref']);
  assert.equal(h.calls.profile, 1);
  assert.equal(h.calls.title, 1);
});

test('bind routes data-nav and data-go buttons through setScreen', () => {
  const h = makeHarness();
  h.controller.bind();
  h.navChat.click();
  assert.deepEqual(h.screens['screen-chat'].toggles.at(-1), ['active', true]);
  h.goEditor.click();
  assert.deepEqual(h.screens['screen-editor'].toggles.at(-1), ['active', true]);
  assert.equal(h.calls.title, 1);
});
