import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountCloudController } from '../public/modules/app/account-cloud.js';

function input(value = '') {
  return { value, checked: false, hidden: false, textContent: '', className: '', addEventListener() {} };
}

function makeElements() {
  return {
    cloudProviderWebdav: { checked: true, addEventListener() {} },
    cloudProviderS3: { checked: false, addEventListener() {} },
    cloudRemotePath: input('backup.json'),
    cloudWebdavUrl: input('https://dav.example'),
    cloudWebdavUser: input('alice'),
    cloudWebdavPass: input('secret'),
    cloudS3Endpoint: input('https://s3.example'),
    cloudS3Region: input('ap-east-1'),
    cloudS3Bucket: input('books'),
    cloudS3AccessKey: input('ak'),
    cloudS3SecretKey: input('sk'),
    cloudFieldsWebdav: { hidden: false },
    cloudFieldsS3: { hidden: true },
    cloudStatus: { textContent: '', className: '' },
    meUsername: { textContent: '' },
    meAvatar: { textContent: '' }
  };
}

function makeController({ elements = makeElements(), fetchImpl = async () => ({ ok: true, json: async () => ({}) }) } = {}) {
  return {
    elements,
    controller: createAccountCloudController({
      $: id => elements[id] || null,
      escHtml: value => String(value),
      escAttr: value => String(value),
      showToast() {},
      showConfirm: async () => true,
      openModal() {},
      closeModal() {},
      authHeaders: () => ({ Authorization: 'Bearer test' }),
      fetchImpl,
      loadBookList: async () => [],
      loadBook: async () => {},
      getCurrentBookId: () => 1,
      renderSidebar() {},
      selectEntry() {},
      renderEditorEmpty() {},
      ensureMemoryLoaded: async () => {}
    })
  };
}

test('cloud config preserves WebDAV field names and default remote path behavior', () => {
  const { controller, elements } = makeController();
  elements.cloudRemotePath.value = '  ';
  assert.deepEqual(controller.cloudConfigFromForm(), {
    provider: 'webdav',
    remote_path: 'world-books-backup.json',
    webdav_url: 'https://dav.example',
    webdav_user: 'alice',
    webdav_pass: 'secret'
  });
});

test('cloud config switches to S3 fields and defaults region', () => {
  const { controller, elements } = makeController();
  elements.cloudProviderS3.checked = true;
  elements.cloudS3Region.value = '';
  assert.deepEqual(controller.cloudConfigFromForm(), {
    provider: 's3',
    remote_path: 'backup.json',
    s3_endpoint: 'https://s3.example',
    s3_region: 'us-east-1',
    s3_bucket: 'books',
    s3_access_key: 'ak',
    s3_secret_key: 'sk'
  });
});

test('requestJson preserves auth headers and JSON body contract', async () => {
  const calls = [];
  const { controller } = makeController({
    fetchImpl: async (path, options) => {
      calls.push([path, options]);
      return { ok: true, json: async () => ({ ok: true }) };
    }
  });
  const result = await controller.requestJson('/api/cloud/config', 'PUT', { a: 1 });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0][0], '/api/cloud/config');
  assert.equal(calls[0][1].method, 'PUT');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test');
  assert.equal(calls[0][1].body, '{"a":1}');
});

test('requestJson surfaces backend error text before HTTP fallback', async () => {
  const { controller } = makeController({
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'offline' }) })
  });
  await assert.rejects(() => controller.requestJson('/api/cloud/test'), /offline/);
});

test('fillProfile writes username and first uppercase avatar character', async () => {
  const { controller, elements } = makeController({
    fetchImpl: async () => ({ ok: true, json: async () => ({ username: 'linhony' }) })
  });
  await controller.fillProfile();
  assert.equal(elements.meUsername.textContent, 'linhony');
  assert.equal(elements.meAvatar.textContent, 'L');
});

test('fillProfile falls back to dash when account request fails', async () => {
  const { controller, elements } = makeController({
    fetchImpl: async () => { throw new Error('network'); }
  });
  await controller.fillProfile();
  assert.equal(elements.meUsername.textContent, '—');
});
