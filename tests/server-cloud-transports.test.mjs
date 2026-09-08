import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createCloudTransports } = require('../server/cloud-transports.js');

const FIXED_DATE = new Date('2026-01-02T03:04:05.000Z');

function response({ ok = true, status = 200, text = '' } = {}) {
  return { ok, status, async text() { return text; } };
}

test('WebDAV helpers preserve Basic auth, path normalization and PUT/GET behavior', async () => {
  const calls = [];
  const transports = createCloudTransports({
    now: () => FIXED_DATE,
    fetchImpl: async (url, options = {}) => {
      calls.push([url, options]);
      return options.method === 'PUT' ? response({ status: 201 }) : response({ text: 'payload' });
    }
  });
  const cfg = {
    provider: 'webdav',
    webdav_url: ' https://dav.example.com/root/ ',
    webdav_user: 'alice',
    webdav_pass: 'secret',
    remote_path: '/folder/main.json'
  };

  assert.deepEqual(transports.webdavAuthHeader(cfg), {
    Authorization: 'Basic ' + Buffer.from('alice:secret').toString('base64')
  });
  assert.equal(transports.webdavTarget(cfg), 'https://dav.example.com/root/folder/main.json');
  await transports.webdavPut(cfg, '/folder/version.json', '{}');
  assert.equal(await transports.webdavGet(cfg, '/folder/version.json'), 'payload');
  assert.equal(calls[0][0], 'https://dav.example.com/root/folder/version.json');
  assert.equal(calls[0][1].method, 'PUT');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json');
  assert.equal(calls[1][0], 'https://dav.example.com/root/folder/version.json');
});

test('WebDAV transport keeps current error and connection-test semantics', async () => {
  const statuses = [500, 404, 401, 503];
  const transports = createCloudTransports({
    fetchImpl: async () => {
      const status = statuses.shift();
      return response({ ok: status >= 200 && status < 300, status, text: 'nope' });
    }
  });
  const cfg = { provider: 'webdav', webdav_url: 'https://dav.example.com', remote_path: 'main.json' };

  await assert.rejects(() => transports.webdavPut(cfg, 'a.json', '{}'), /WebDAV PUT 500/);
  assert.deepEqual(await transports.testConnection(cfg), { ok: true });
  assert.deepEqual(await transports.testConnection(cfg), { ok: false, error: 'WebDAV 认证失败（401）' });
  assert.deepEqual(await transports.testConnection(cfg), { ok: false, error: 'WebDAV 连接异常 503' });
  assert.deepEqual(await transports.testConnection({ provider: 'webdav' }), { ok: false, error: 'WebDAV 配置不完整' });
});

test('S3 SigV4 helpers preserve deterministic scope, signed header casing and encoded object URL', () => {
  const transports = createCloudTransports({ now: () => FIXED_DATE, fetchImpl: async () => response() });
  const cfg = {
    provider: 's3',
    s3_endpoint: 'https://s3.example.com/',
    s3_region: 'us-east-1',
    s3_bucket: 'my bucket',
    s3_access_key: 'AKID',
    s3_secret_key: 'SECRET'
  };
  const headers = transports.s3Headers(cfg, 'PUT', '/folder/a b.json', '{}', { 'Content-Type': 'application/json' });

  assert.equal(headers['X-Amz-Date'], '20260102T030405Z');
  assert.match(headers.Authorization, /Credential=AKID\/20260102\/us-east-1\/s3\/aws4_request/);
  assert.match(headers.Authorization, /SignedHeaders=Content-Type;host;x-amz-content-sha256;x-amz-date/);
  assert.equal(transports.s3ObjectUrl(cfg, '/folder/a b.json'), 'https://s3.example.com/my%20bucket/folder/a%20b.json');
  assert.equal(transports.s3EncodePath('a b/c+d'), 'a%20b/c%2Bd');
});

test('cloud action chooses provider and defaults downloads to remote_path', async () => {
  const calls = [];
  const transports = createCloudTransports({
    now: () => FIXED_DATE,
    fetchImpl: async (url, options = {}) => {
      calls.push([url, options]);
      return response({ text: 'downloaded' });
    }
  });
  const webdav = { provider: 'webdav', webdav_url: 'https://dav.example.com', remote_path: '/main.json' };
  const action = transports.action(webdav);
  assert.equal(await action.download(), 'downloaded');
  assert.equal(calls[0][0], 'https://dav.example.com/main.json');

  assert.deepEqual(await transports.testConnection({ provider: 's3' }), { ok: false, error: 'S3 配置不完整' });
});
