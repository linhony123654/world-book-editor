const PROFILE_KEY = 'wbe-api-profiles';
const ACTIVE_KEY = 'wbe-api-active';
const LEGACY_KEYS = Object.freeze({
  url: 'wbe-api-url',
  key: 'wbe-api-key',
  model: 'wbe-model',
  prompt: 'wbe-system-prompt'
});

function safeParseProfiles(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function normalizeImportedProfiles(profiles) {
  if (!Array.isArray(profiles)) return [];
  return profiles.filter(profile => profile && profile.id && profile.url);
}

export function createApiProfileRepository({
  storage = globalThis.localStorage,
  now = () => Date.now(),
  onActiveChanged = () => {}
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('API profile repository requires Web Storage');
  }

  function mirrorLegacy(profile) {
    storage.setItem(LEGACY_KEYS.url, profile?.url || '');
    storage.setItem(LEGACY_KEYS.key, profile?.key || '');
    storage.setItem(LEGACY_KEYS.model, profile?.model || '');
    storage.setItem(LEGACY_KEYS.prompt, profile?.prompt || '');
  }

  function save(profiles) {
    const list = Array.isArray(profiles) ? profiles : [];
    storage.setItem(PROFILE_KEY, JSON.stringify(list));
    return list;
  }

  function activeId() {
    return storage.getItem(ACTIVE_KEY) || '';
  }

  function load() {
    let profiles = safeParseProfiles(storage.getItem(PROFILE_KEY));
    if (profiles.length) return profiles;

    const url = storage.getItem(LEGACY_KEYS.url) || '';
    const key = storage.getItem(LEGACY_KEYS.key) || '';
    if (!url && !key) return profiles;

    profiles = [{
      id: 'p' + now(),
      name: '默认配置',
      url,
      key,
      model: storage.getItem(LEGACY_KEYS.model) || '',
      prompt: storage.getItem(LEGACY_KEYS.prompt) || ''
    }];
    save(profiles);
    storage.setItem(ACTIVE_KEY, profiles[0].id);
    return profiles;
  }

  function get(id) {
    return load().find(profile => profile.id === id) || null;
  }

  function setActive(id, { notify = true } = {}) {
    const profile = get(id);
    if (!profile) return null;
    storage.setItem(ACTIVE_KEY, id);
    mirrorLegacy(profile);
    if (notify) onActiveChanged(profile);
    return profile;
  }

  function clearActive({ notify = true } = {}) {
    storage.removeItem(ACTIVE_KEY);
    mirrorLegacy(null);
    if (notify) onActiveChanged(null);
  }

  function replaceImported(profiles, requestedActiveId, { notify = true } = {}) {
    const valid = normalizeImportedProfiles(profiles);
    if (!valid.length) return { profiles: [], active: null };

    save(valid);
    const active = valid.find(profile => profile.id === requestedActiveId) || valid[0];
    storage.setItem(ACTIVE_KEY, active.id);
    mirrorLegacy(active);
    if (notify) onActiveChanged(active);
    return { profiles: valid, active };
  }

  return {
    load,
    save,
    activeId,
    get,
    setActive,
    clearActive,
    mirrorLegacy,
    replaceImported
  };
}
