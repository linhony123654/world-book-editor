export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

export function themePresentation(theme) {
  const normalized = normalizeTheme(theme);
  return normalized === 'dark'
    ? { theme: 'dark', label: '夜墨模式 · 深色背景', themeColor: '#11110f', switchOff: true }
    : { theme: 'light', label: '暖纸张、墨色正文与酒红强调', themeColor: '#f3efe7', switchOff: false };
}

export function formatUsageLabel(usage = {}) {
  const sessions = Number(usage.sessions) || 0;
  const tokens = Number(usage.tokens) || 0;
  const withStats = Number(usage.withStats) || 0;
  if (sessions <= 0) return '';
  return sessions + ' 个会话 · 累计发送 ≈ ' + tokens.toLocaleString() + ' tok' +
    (withStats < sessions ? '（旧会话未计入）' : '');
}

export function createPreferencesController({
  $,
  documentRef = globalThis.document,
  storage = globalThis.localStorage,
  profileRepo,
  escHtml = value => String(value),
  escAttr = value => String(value),
  apiStatusText = () => '',
  readChatVisibleLimit = () => 10,
  saveChatVisibleLimit = value => Number(value) || 0,
  applyChatVisibleLimit = () => {},
  getChatUsage = async () => ({ sessions: 0, tokens: 0, withStats: 0 }),
  showToast = () => {}
} = {}) {
  if (typeof $ !== 'function') throw new TypeError('Preferences controller requires element lookup');
  if (!documentRef) throw new TypeError('Preferences controller requires document');
  if (!storage) throw new TypeError('Preferences controller requires storage');
  if (!profileRepo) throw new TypeError('Preferences controller requires profile repository');

  function syncSwitch(sw) {
    if (sw) sw.setAttribute('aria-checked', sw.classList.contains('off') ? 'false' : 'true');
  }

  function setSettingsTab(tab) {
    documentRef.querySelectorAll('.settings-tabs .tab').forEach(button => {
      button.classList.toggle('active', button.dataset.settab === tab);
    });
    documentRef.querySelectorAll('.settings-pane').forEach(pane => {
      pane.hidden = pane.dataset.pane !== tab;
    });
  }

  function bindSettingsTabs() {
    documentRef.querySelectorAll('.settings-tabs .tab').forEach(button => {
      button.addEventListener('click', () => setSettingsTab(button.dataset.settab));
    });
  }

  function applyTheme(theme) {
    const presentation = themePresentation(theme);
    documentRef.documentElement.setAttribute('data-theme', presentation.theme);
    const sw = $('themeSwitch');
    if (sw) {
      sw.classList.toggle('off', presentation.switchOff);
      syncSwitch(sw);
    }
    const label = $('themeLabel');
    if (label) label.textContent = presentation.label;
    const meta = documentRef.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', presentation.themeColor);
    return presentation.theme;
  }

  function initTheme() {
    applyTheme(storage.getItem('wbe-theme') || 'light');
    const sw = $('themeSwitch');
    if (!sw) return;
    sw.addEventListener('click', () => {
      const next = documentRef.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      storage.setItem('wbe-theme', next);
    });
  }

  function initAutoSaveSwitch() {
    const sw = $('autoSaveSwitch');
    if (!sw) return;
    sw.classList.toggle('off', storage.getItem('wbe-autosave') === 'off');
    syncSwitch(sw);
    sw.addEventListener('click', () => {
      const off = sw.classList.toggle('off');
      syncSwitch(sw);
      storage.setItem('wbe-autosave', off ? 'off' : 'on');
      showToast(off ? '已关闭自动保存' : '已开启自动保存', 'success');
    });
  }

  function bindChatVisibleLimit() {
    const input = $('chatVisibleLimitInput');
    if (!input) return;
    input.addEventListener('change', () => {
      const limit = saveChatVisibleLimit(input.value);
      input.value = String(limit);
      applyChatVisibleLimit();
      showToast(limit === 0 ? '会话已设为显示全部' : '会话显示最近 ' + limit + ' 条', 'success');
    });
  }

  async function refreshSettings() {
    const profiles = profileRepo.load();
    const active = profileRepo.get(profileRepo.activeId()) || profiles[0] || null;

    const status = $('apiStatusLabel');
    if (status) status.textContent = apiStatusText(active);

    const quick = $('apiProfileSelect');
    if (quick) {
      if (!profiles.length) {
        quick.style.display = 'none';
      } else {
        quick.style.display = '';
        quick.innerHTML = profiles.map(profile =>
          '<option value="' + escAttr(profile.id) + '">' + escHtml(profile.name || '未命名') + '</option>'
        ).join('');
        quick.value = active?.id || profiles[0].id;
      }
    }

    const autoSave = $('autoSaveSwitch');
    if (autoSave) {
      autoSave.classList.toggle('off', storage.getItem('wbe-autosave') === 'off');
      syncSwitch(autoSave);
    }

    const usageRow = $('usageStatsRow');
    const usageLabel = $('usageStatsLabel');
    if (usageRow && usageLabel) {
      try {
        const usage = await getChatUsage();
        const text = formatUsageLabel(usage);
        usageRow.style.display = text ? '' : 'none';
        if (text) usageLabel.textContent = text;
      } catch {
        usageRow.style.display = 'none';
      }
    }

    const chatLimit = $('chatVisibleLimitInput');
    if (chatLimit) chatLimit.value = String(readChatVisibleLimit());
  }

  function bind() {
    bindSettingsTabs();
    bindChatVisibleLimit();
    initTheme();
    initAutoSaveSwitch();
  }

  return {
    bind,
    bindSettingsTabs,
    bindChatVisibleLimit,
    setSettingsTab,
    syncSwitch,
    applyTheme,
    initTheme,
    initAutoSaveSwitch,
    refreshSettings
  };
}
