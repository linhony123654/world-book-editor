export function createAccountCloudController({
  $,
  escHtml,
  escAttr,
  showToast,
  showConfirm,
  openModal,
  closeModal,
  authHeaders,
  fetchImpl = (...args) => fetch(...args),
  loadBookList,
  loadBook,
  getCurrentBookId,
  renderSidebar,
  selectEntry,
  renderEditorEmpty,
  ensureMemoryLoaded
} = {}) {
  if (typeof $ !== 'function') throw new TypeError('account/cloud controller requires $');
  if (typeof fetchImpl !== 'function') throw new TypeError('account/cloud controller requires fetch');

  function setCloudStatus(message, className) {
    const element = $('cloudStatus');
    if (!element) return;
    element.textContent = message || '';
    element.className = 'cloud-status' + (className ? ' ' + className : '');
  }

  function cloudProvider() {
    return $('cloudProviderS3')?.checked ? 's3' : 'webdav';
  }

  function cloudConfigFromForm() {
    const config = {
      provider: cloudProvider(),
      remote_path: $('cloudRemotePath').value.trim() || 'world-books-backup.json'
    };
    if (config.provider === 's3') {
      config.s3_endpoint = $('cloudS3Endpoint').value.trim();
      config.s3_region = $('cloudS3Region').value.trim() || 'us-east-1';
      config.s3_bucket = $('cloudS3Bucket').value.trim();
      config.s3_access_key = $('cloudS3AccessKey').value.trim();
      config.s3_secret_key = $('cloudS3SecretKey').value;
    } else {
      config.webdav_url = $('cloudWebdavUrl').value.trim();
      config.webdav_user = $('cloudWebdavUser').value.trim();
      config.webdav_pass = $('cloudWebdavPass').value;
    }
    return config;
  }

  function cloudFillForm(config) {
    if (!config) return;
    const isS3 = config.provider === 's3';
    const webdavRadio = $('cloudProviderWebdav');
    const s3Radio = $('cloudProviderS3');
    if (webdavRadio) webdavRadio.checked = !isS3;
    if (s3Radio) s3Radio.checked = isS3;
    if ($('cloudFieldsWebdav')) $('cloudFieldsWebdav').hidden = isS3;
    if ($('cloudFieldsS3')) $('cloudFieldsS3').hidden = !isS3;
    if ($('cloudWebdavUrl')) $('cloudWebdavUrl').value = config.webdav_url || '';
    if ($('cloudWebdavUser')) $('cloudWebdavUser').value = config.webdav_user || '';
    if ($('cloudWebdavPass')) $('cloudWebdavPass').value = config.webdav_pass || '';
    if ($('cloudS3Endpoint')) $('cloudS3Endpoint').value = config.s3_endpoint || '';
    if ($('cloudS3Region')) $('cloudS3Region').value = config.s3_region || 'us-east-1';
    if ($('cloudS3Bucket')) $('cloudS3Bucket').value = config.s3_bucket || '';
    if ($('cloudS3AccessKey')) $('cloudS3AccessKey').value = config.s3_access_key || '';
    if ($('cloudS3SecretKey')) $('cloudS3SecretKey').value = config.s3_secret_key || '';
    if ($('cloudRemotePath')) $('cloudRemotePath').value = config.remote_path || 'world-books-backup.json';
  }

  async function requestJson(path, method, body) {
    const options = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', ...authHeaders() }
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetchImpl(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
    return data;
  }

  async function reloadCurrentBook() {
    const books = await loadBookList();
    const currentId = getCurrentBookId();
    const target = books.find(book => book.id === currentId) || books[0];
    if (target) {
      await loadBook(target.id, renderSidebar, selectEntry, renderEditorEmpty);
      await ensureMemoryLoaded();
    } else {
      renderEditorEmpty();
    }
  }

  async function fillProfile() {
    const nameEl = $('meUsername');
    const avatarEl = $('meAvatar');
    if (!nameEl) return;
    try {
      const data = await requestJson('/api/me', 'GET');
      if (data.username) {
        nameEl.textContent = data.username;
        if (avatarEl) avatarEl.textContent = String(data.username).slice(0, 1).toUpperCase();
      }
    } catch {
      nameEl.textContent = '—';
    }
  }

  function bindCloud() {
    const loadConfig = async () => {
      try {
        cloudFillForm(await requestJson('/api/cloud/config'));
      } catch (error) {
        setCloudStatus('配置读取失败: ' + error.message, 'err');
      }
    };
    loadConfig();

    const webdavRadio = $('cloudProviderWebdav');
    const s3Radio = $('cloudProviderS3');
    if (webdavRadio && s3Radio) {
      const onToggle = () => {
        const isS3 = s3Radio.checked;
        const webdavFields = $('cloudFieldsWebdav');
        const s3Fields = $('cloudFieldsS3');
        if (webdavFields) webdavFields.hidden = isS3;
        if (s3Fields) s3Fields.hidden = !isS3;
      };
      webdavRadio.addEventListener('change', onToggle);
      s3Radio.addEventListener('change', onToggle);
    }

    $('cloudSaveBtn')?.addEventListener('click', async () => {
      try {
        await requestJson('/api/cloud/config', 'PUT', cloudConfigFromForm());
        setCloudStatus('配置已保存', 'ok');
        showToast('外置存储配置已保存', 'success');
      } catch (error) {
        setCloudStatus('保存失败: ' + error.message, 'err');
      }
    });

    $('cloudTestBtn')?.addEventListener('click', async () => {
      try {
        await requestJson('/api/cloud/config', 'PUT', cloudConfigFromForm());
        setCloudStatus('测试中…');
        const result = await requestJson('/api/cloud/test', 'POST');
        if (result.ok) {
          setCloudStatus('连接正常', 'ok');
          showToast('云端连接正常', 'success');
        } else {
          setCloudStatus(result.error || '连接失败', 'err');
          showToast(result.error || '连接失败', 'error');
        }
      } catch (error) {
        setCloudStatus('测试失败: ' + error.message, 'err');
      }
    });

    $('cloudUploadBtn')?.addEventListener('click', async () => {
      try {
        await requestJson('/api/cloud/config', 'PUT', cloudConfigFromForm());
        setCloudStatus('上传中…');
        const result = await requestJson('/api/cloud/upload', 'POST');
        setCloudStatus(
          '已上传 ' + result.books + ' 本世界书（' + String(result.exportedAt || '').replace('T', ' ').slice(0, 19) + '）',
          'ok'
        );
        showToast('已上传 ' + result.books + ' 本世界书到云端', 'success');
      } catch (error) {
        setCloudStatus('上传失败: ' + error.message, 'err');
        showToast('上传失败: ' + error.message, 'error');
      }
    });

    $('cloudDownloadBtn')?.addEventListener('click', async () => {
      const ok = await showConfirm({
        title: '从云端拉取',
        message: '将用云端备份整体覆盖当前所有世界书与 AI 记忆。本地当前数据会先自动备份到 backups/cloud/。继续？',
        okText: '拉取并覆盖',
        danger: true
      });
      if (!ok) return;
      try {
        await requestJson('/api/cloud/config', 'PUT', cloudConfigFromForm());
        setCloudStatus('拉取中…');
        const result = await requestJson('/api/cloud/download', 'POST');
        await reloadCurrentBook();
        setCloudStatus('已恢复 ' + result.books + ' 本世界书', 'ok');
        showToast('已从云端恢复 ' + result.books + ' 本世界书', 'success');
      } catch (error) {
        setCloudStatus('拉取失败: ' + error.message, 'err');
        showToast('拉取失败: ' + error.message, 'error');
      }
    });

    $('cloudVersionsBtn')?.addEventListener('click', async () => {
      const list = $('cloudVersionsList');
      if (!list) return;
      list.innerHTML = '<div class="empty-list">加载中…</div>';
      openModal($('cloudVersionsModal'));
      try {
        const result = await requestJson('/api/cloud/versions', 'GET');
        if (!result.versions || result.versions.length === 0) {
          list.innerHTML = '<div class="empty-list">暂无历史版本，上传时自动保留最近 5 个。</div>';
          return;
        }
        list.innerHTML = result.versions.map(version =>
          '<div class="shortcut-row">' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' +
              '<small style="display:block;opacity:.7">' + escHtml(String(version.path).split('/').pop()) + '</small>' +
              escHtml(String(version.uploaded_at || '').replace('T', ' ').slice(0, 19)) +
            '</span>' +
            '<button class="action danger" data-vpath="' + escAttr(version.path) + '">拉取</button>' +
          '</div>'
        ).join('');

        list.querySelectorAll('[data-vpath]').forEach(button => {
          button.addEventListener('click', async () => {
            const ok = await showConfirm({
              title: '拉取历史版本',
              message: '将用该历史版本整体覆盖当前所有世界书与 AI 记忆（本地先备份到 backups/cloud/）。继续？',
              okText: '拉取并覆盖',
              danger: true
            });
            if (!ok) return;
            try {
              await requestJson('/api/cloud/config', 'PUT', cloudConfigFromForm());
              const restoreResult = await requestJson('/api/cloud/download', 'POST', { versionPath: button.dataset.vpath });
              closeModal($('cloudVersionsModal'));
              await reloadCurrentBook();
              setCloudStatus('已恢复历史版本（' + restoreResult.books + ' 本世界书）', 'ok');
              showToast('已从历史版本恢复 ' + restoreResult.books + ' 本世界书', 'success');
            } catch (error) {
              showToast('拉取失败: ' + error.message, 'error');
            }
          });
        });
      } catch (error) {
        list.innerHTML = '<div class="empty-list">读取失败: ' + escHtml(error.message) + '</div>';
      }
    });
  }

  function bindMe() {
    $('meShortcutBtn')?.addEventListener('click', () => openModal($('shortcutModal')));
    $('meAboutBtn')?.addEventListener('click', () => openModal($('aboutModal')));
  }

  return {
    bindCloud,
    bindMe,
    fillProfile,
    requestJson,
    cloudConfigFromForm,
    cloudFillForm,
    reloadCurrentBook
  };
}
