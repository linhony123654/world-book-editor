export function createAppBootstrapController({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  bindAuth,
  checkAuth,
  showLoginScreen = () => {},
  binders = [],
  initSidebar = () => {},
  initChat = () => {},
  initBooks = () => {},
  setWbeDeps = () => {},
  renderSidebar = () => {},
  selectEntry = () => {},
  renderEditorEmpty = () => {},
  setScreen = () => {},
  loadBookList,
  chooseInitialBookId,
  loadBook,
  ensureMemoryLoaded = async () => {},
  refreshSettings = () => {}
} = {}) {
  if (typeof bindAuth !== 'function') throw new TypeError('App bootstrap requires bindAuth');
  if (typeof checkAuth !== 'function') throw new TypeError('App bootstrap requires checkAuth');
  if (typeof loadBookList !== 'function') throw new TypeError('App bootstrap requires loadBookList');
  if (typeof chooseInitialBookId !== 'function') throw new TypeError('App bootstrap requires chooseInitialBookId');
  if (typeof loadBook !== 'function') throw new TypeError('App bootstrap requires loadBook');

  async function boot() {
    binders.forEach(bind => bind());

    initSidebar(selectEntry, setScreen);
    initChat();
    initBooks({ renderSidebar, selectEntry, renderEditorEmpty }, setScreen);
    setWbeDeps({ renderSidebar, selectEntry, renderEditorEmpty });

    documentRef?.addEventListener?.('wbe:goto-editor', () => setScreen('editor'));

    const books = await loadBookList();
    if (books.length > 0) {
      await loadBook(chooseInitialBookId(books), renderSidebar, selectEntry, renderEditorEmpty);
      await ensureMemoryLoaded();
    } else {
      renderEditorEmpty();
    }
    refreshSettings();
    return books;
  }

  async function init() {
    bindAuth();
    const authed = await checkAuth();
    if (!authed) {
      windowRef?.addEventListener?.('wbe:authenticated', () => boot(), { once: true });
      windowRef?.addEventListener?.('wbe:unauthorized', () => { showLoginScreen('login'); });
      return false;
    }
    boot();
    return true;
  }

  return { boot, init };
}
