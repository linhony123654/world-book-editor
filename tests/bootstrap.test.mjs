import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppBootstrapController } from '../public/modules/app/bootstrap.js';

function makeHarness({ authed = true, books = [{ id: 'book-1' }] } = {}) {
  const order = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const calls = { loadBook: [], initBooks: [], wbeDeps: [], screens: [], login: [] };
  let resolveBoot;
  const bootDone = new Promise(resolve => { resolveBoot = resolve; });

  const selectEntry = uid => order.push('select:' + uid);
  const renderSidebar = () => order.push('renderSidebar');
  const renderEditorEmpty = () => order.push('empty');
  const setScreen = name => { calls.screens.push(name); order.push('screen:' + name); };

  const controller = createAppBootstrapController({
    windowRef: {
      addEventListener(type, handler, options) { windowListeners.set(type, { handler, options }); }
    },
    documentRef: {
      addEventListener(type, handler) { documentListeners.set(type, handler); }
    },
    bindAuth: () => order.push('bindAuth'),
    checkAuth: async () => { order.push('checkAuth'); return authed; },
    showLoginScreen: mode => { calls.login.push(mode); order.push('login:' + mode); },
    binders: [
      () => order.push('bind:navigation'),
      () => order.push('bind:entries'),
      () => order.push('bind:settings')
    ],
    initSidebar: (select, screen) => {
      assert.equal(select, selectEntry);
      assert.equal(screen, setScreen);
      order.push('initSidebar');
    },
    initChat: () => order.push('initChat'),
    initBooks: (deps, screen) => {
      calls.initBooks.push({ deps, screen });
      order.push('initBooks');
    },
    setWbeDeps: deps => { calls.wbeDeps.push(deps); order.push('setWbeDeps'); },
    renderSidebar,
    selectEntry,
    renderEditorEmpty,
    setScreen,
    loadBookList: async () => { order.push('loadBookList'); return books; },
    chooseInitialBookId: list => { order.push('chooseInitialBook'); return list[0]?.id || null; },
    loadBook: async (...args) => { calls.loadBook.push(args); order.push('loadBook'); },
    ensureMemoryLoaded: async () => { order.push('memory'); },
    refreshSettings: () => { order.push('refresh'); resolveBoot(); }
  });

  return { controller, order, windowListeners, documentListeners, calls, bootDone, selectEntry, renderSidebar, renderEditorEmpty, setScreen };
}

test('authenticated init starts boot without changing the legacy non-awaited init contract', async () => {
  const h = makeHarness();
  assert.equal(await h.controller.init(), true);
  assert.deepEqual(h.order.slice(0, 5), ['bindAuth', 'checkAuth', 'bind:navigation', 'bind:entries', 'bind:settings']);
  await h.bootDone;
  assert.deepEqual(h.order, [
    'bindAuth', 'checkAuth',
    'bind:navigation', 'bind:entries', 'bind:settings',
    'initSidebar', 'initChat', 'initBooks', 'setWbeDeps',
    'loadBookList', 'chooseInitialBook', 'loadBook', 'memory', 'refresh'
  ]);
});

test('unauthenticated init registers one-shot authenticated boot and unauthorized login handlers', async () => {
  const h = makeHarness({ authed: false });
  assert.equal(await h.controller.init(), false);
  assert.deepEqual(h.order, ['bindAuth', 'checkAuth']);
  assert.equal(h.windowListeners.get('wbe:authenticated').options.once, true);

  h.windowListeners.get('wbe:unauthorized').handler();
  assert.deepEqual(h.calls.login, ['login']);

  h.windowListeners.get('wbe:authenticated').handler();
  await h.bootDone;
  assert.ok(h.order.includes('bind:navigation'));
  assert.ok(h.order.includes('refresh'));
});

test('boot initializes sidebar/chat/books/api dependencies before loading the initial book', async () => {
  const h = makeHarness({ books: [{ id: 'remembered' }, { id: 'other' }] });
  const result = await h.controller.boot();
  assert.equal(result.length, 2);
  assert.equal(h.calls.initBooks.length, 1);
  assert.equal(h.calls.initBooks[0].deps.renderSidebar, h.renderSidebar);
  assert.equal(h.calls.initBooks[0].deps.selectEntry, h.selectEntry);
  assert.equal(h.calls.initBooks[0].deps.renderEditorEmpty, h.renderEditorEmpty);
  assert.equal(h.calls.initBooks[0].screen, h.setScreen);
  assert.equal(h.calls.wbeDeps.length, 1);
  assert.equal(h.calls.loadBook[0][0], 'remembered');
  assert.equal(h.calls.loadBook[0][1], h.renderSidebar);
  assert.equal(h.calls.loadBook[0][2], h.selectEntry);
  assert.equal(h.calls.loadBook[0][3], h.renderEditorEmpty);
});

test('empty library renders editor empty, skips memory load and still refreshes settings', async () => {
  const h = makeHarness({ books: [] });
  await h.controller.boot();
  assert.equal(h.calls.loadBook.length, 0);
  assert.ok(h.order.includes('empty'));
  assert.equal(h.order.includes('memory'), false);
  assert.equal(h.order.at(-1), 'refresh');
});

test('goto-editor application event delegates to navigation screen setter', async () => {
  const h = makeHarness();
  await h.controller.boot();
  assert.equal(typeof h.documentListeners.get('wbe:goto-editor'), 'function');
  h.documentListeners.get('wbe:goto-editor')();
  assert.deepEqual(h.calls.screens, ['editor']);
});
