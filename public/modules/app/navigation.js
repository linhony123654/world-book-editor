export const APP_SCREENS = Object.freeze(['library', 'editor', 'chat', 'archives', 'settings', 'me']);

export function createNavigationController({
  $,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  screens = APP_SCREENS,
  renderArchives = () => {},
  refreshSettings = () => {},
  setSettingsTab = () => {},
  fillProfile = () => {},
  autoSizeTitle = () => {}
} = {}) {
  if (typeof $ !== 'function') throw new TypeError('Navigation controller requires element lookup');
  const allowedScreens = [...screens];

  function setScreen(name) {
    if (!allowedScreens.includes(name)) return false;

    allowedScreens.forEach(screen => {
      const el = $('screen-' + screen);
      if (el) el.classList.toggle('active', screen === name);
    });

    documentRef?.querySelectorAll?.('.bottom-nav .nav').forEach(button => {
      button.classList.toggle('active', button.dataset.nav === name);
    });

    const app = documentRef?.querySelector?.('.app');
    if (app) app.scrollTop = name === 'chat' ? app.scrollHeight : 0;
    else windowRef?.scrollTo?.(0, 0);

    if (name === 'archives') renderArchives();
    if (name === 'settings') {
      refreshSettings();
      setSettingsTab('pref');
    }
    if (name === 'me') fillProfile();
    if (name === 'editor') autoSizeTitle();
    return true;
  }

  function bind() {
    documentRef?.querySelectorAll?.('[data-nav]').forEach(button => {
      button.addEventListener('click', () => setScreen(button.dataset.nav));
    });
    documentRef?.querySelectorAll?.('[data-go]').forEach(button => {
      button.addEventListener('click', () => setScreen(button.dataset.go));
    });
  }

  return { bind, setScreen };
}
