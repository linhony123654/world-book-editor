export function buildConfigKeyPayload(profileRepo) {
  return JSON.stringify({
    p: profileRepo.load(),
    a: profileRepo.activeId(),
    v: 1
  });
}

export function parseConfigKeyPayload(payloadJson) {
  const payload = JSON.parse(payloadJson);
  if (!payload || !Array.isArray(payload.p)) throw new Error('bad key');
  return payload;
}

export function createDataToolsController({
  $,
  importFile,
  exportFile,
  exportMarkdown,
  loadBookList,
  loadBook,
  getCurrentBookId,
  renderSidebar,
  selectEntry,
  renderEditorEmpty,
  ensureMemoryLoaded,
  profileRepo,
  refreshSettings = () => {},
  encryptConfigKey,
  decryptConfigKey,
  decodeLegacyConfigKey,
  isEncryptedConfigKey,
  copyText,
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
  promptFn = (...args) => globalThis.prompt?.(...args),
  showToast = () => {}
} = {}) {
  if (typeof $ !== 'function') throw new TypeError('Data tools controller requires element lookup');
  if (!profileRepo) throw new TypeError('Data tools controller requires profile repository');

  async function copyConfigKey() {
    const password = promptFn('设置秘钥密码（导入时需要输入同一密码；建议 ≥6 位）');
    if (password === null) return false;
    if (!String(password).trim()) {
      showToast('密码不能为空', 'error');
      return false;
    }

    try {
      const key = await encryptConfigKey(buildConfigKeyPayload(profileRepo), password);
      const copied = await copyText(key, { navigatorRef, documentRef });
      if (copied) {
        showToast('已加密并复制，导入时输入同一密码即可', 'success');
      } else {
        promptFn('复制失败，请手动复制以下秘钥：', key);
      }
      return copied;
    } catch (error) {
      showToast('加密失败: ' + error.message, 'error');
      return false;
    }
  }

  async function importConfigKey() {
    const raw = String($('configKeyInput')?.value || '').trim();
    if (!raw) {
      showToast('请先粘贴秘钥', 'error');
      return null;
    }

    try {
      let payloadJson;
      if (isEncryptedConfigKey(raw)) {
        const password = promptFn('输入秘钥密码');
        if (password === null) return null;
        payloadJson = await decryptConfigKey(raw, password);
      } else {
        payloadJson = decodeLegacyConfigKey(raw);
      }
      const payload = parseConfigKeyPayload(payloadJson);
      const imported = profileRepo.replaceImported(payload.p, payload.a);
      if (!imported.profiles.length) throw new Error('no profiles');
      await refreshSettings();
      showToast('已导入 ' + imported.profiles.length + ' 个接口配置', 'success');
      return imported;
    } catch {
      showToast('秘钥无效或密码错误', 'error');
      return null;
    }
  }

  async function reloadCurrentBook() {
    const books = await loadBookList();
    const currentId = getCurrentBookId?.();
    const target = books.find(book => book.id === currentId) || books[0];
    if (!target) {
      showToast('没有可加载的世界书', 'error');
      return null;
    }
    await loadBook(target.id, renderSidebar, selectEntry, renderEditorEmpty);
    await ensureMemoryLoaded();
    return target;
  }

  function bindFileTransfer() {
    $('importBtn')?.addEventListener('click', () => $('file-input')?.click());
    $('file-input')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) importFile(file, renderSidebar, selectEntry, renderEditorEmpty);
      event.target.value = '';
    });
    $('exportBtn')?.addEventListener('click', exportFile);
    $('exportMdBtn')?.addEventListener('click', exportMarkdown);
  }

  function bind() {
    bindFileTransfer();
    $('copyConfigKeyBtn')?.addEventListener('click', copyConfigKey);
    $('importConfigKeyBtn')?.addEventListener('click', importConfigKey);
    $('reloadBtn')?.addEventListener('click', reloadCurrentBook);
  }

  return {
    bind,
    bindFileTransfer,
    copyConfigKey,
    importConfigKey,
    reloadCurrentBook
  };
}
