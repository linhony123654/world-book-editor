const crypto = require('crypto');

function createCloudTransports({ fetchImpl = globalThis.fetch, cryptoImpl = crypto, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Cloud transports require fetch');

  function webdavAuthHeader(cfg) {
    if (!cfg.webdav_user) return {};
    return {
      Authorization: 'Basic ' + Buffer.from(cfg.webdav_user + ':' + (cfg.webdav_pass || '')).toString('base64')
    };
  }

  function webdavTarget(cfg) {
    const base = String(cfg.webdav_url || '').trim().replace(/\/+$/, '');
    const objectPath = String(cfg.remote_path || 'world-books-backup.json').replace(/^\/+/, '');
    return base + '/' + objectPath;
  }

  async function webdavPut(cfg, objectPath, body) {
    const base = String(cfg.webdav_url || '').trim().replace(/\/+$/, '');
    const targetPath = String(objectPath || '').replace(/^\/+/, '');
    const response = await fetchImpl(base + '/' + targetPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...webdavAuthHeader(cfg) },
      body
    });
    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error('WebDAV PUT ' + response.status);
    }
    return response;
  }

  async function webdavGet(cfg, objectPath) {
    const base = String(cfg.webdav_url || '').trim().replace(/\/+$/, '');
    const targetPath = String(objectPath || '').replace(/^\/+/, '');
    const response = await fetchImpl(base + '/' + targetPath, { headers: { ...webdavAuthHeader(cfg) } });
    if (!response.ok) throw new Error('WebDAV GET ' + response.status);
    return response.text();
  }

  function s3Sha256hex(data) {
    return cryptoImpl.createHash('sha256').update(data).digest('hex');
  }

  function s3Hmac(key, data) {
    return cryptoImpl.createHmac('sha256', key).update(data).digest();
  }

  function s3EncodePath(value) {
    return String(value).split('/').map(segment => encodeURIComponent(segment).replace(/%2F/gi, '/')).join('/');
  }

  function s3Headers(cfg, method, objectPath, body, extraHeaders) {
    const endpoint = String(cfg.s3_endpoint || '').trim().replace(/\/+$/, '');
    const region = String(cfg.s3_region || 'us-east-1').trim();
    const date = now();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const canonicalUri = '/' + s3EncodePath(String(cfg.s3_bucket || '') + '/' + String(objectPath || '').replace(/^\/+/, ''));
    const payloadHash = body == null ? s3Sha256hex('') : s3Sha256hex(body);
    const host = new URL(endpoint).host;
    const headers = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders
    };
    const canonicalHeaders = Object.keys(headers).sort().map(key => key + ':' + headers[key]).join('\n') + '\n';
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = dateStamp + '/' + region + '/s3/aws4_request';
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, s3Sha256hex(canonicalRequest)].join('\n');
    const kDate = s3Hmac('AWS4' + cfg.s3_secret_key, dateStamp);
    const kRegion = s3Hmac(kDate, region);
    const kService = s3Hmac(kRegion, 's3');
    const kSigning = s3Hmac(kService, 'aws4_request');
    const signature = cryptoImpl.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    return {
      Authorization: 'AWS4-HMAC-SHA256 Credential=' + cfg.s3_access_key + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
      'X-Amz-Date': amzDate,
      'x-amz-content-sha256': payloadHash
    };
  }

  function s3ObjectUrl(cfg, objectPath) {
    const endpoint = String(cfg.s3_endpoint || '').trim().replace(/\/+$/, '');
    return endpoint + '/' + s3EncodePath(String(cfg.s3_bucket || '') + '/' + String(objectPath || '').replace(/^\/+/, ''));
  }

  async function s3Put(cfg, objectPath, body) {
    const targetPath = String(objectPath || '').replace(/^\/+/, '');
    const headers = s3Headers(cfg, 'PUT', targetPath, body, { 'Content-Type': 'application/json' });
    const response = await fetchImpl(s3ObjectUrl(cfg, targetPath), { method: 'PUT', headers, body });
    if (!response.ok) throw new Error('S3 PUT ' + response.status + ': ' + (await response.text()).slice(0, 200));
    return response;
  }

  async function s3Get(cfg, objectPath) {
    const targetPath = String(objectPath || '').replace(/^\/+/, '');
    const headers = s3Headers(cfg, 'GET', targetPath, null);
    const response = await fetchImpl(s3ObjectUrl(cfg, targetPath), { headers });
    if (!response.ok) throw new Error('S3 GET ' + response.status + ': ' + (await response.text()).slice(0, 200));
    return response.text();
  }

  function action(cfg) {
    const mainPath = String(cfg.remote_path || 'world-books-backup.json').replace(/^\/+/, '');
    return {
      upload: (objectPath, body) => cfg.provider === 's3'
        ? s3Put(cfg, objectPath, body)
        : webdavPut(cfg, objectPath, body),
      download: objectPath => cfg.provider === 's3'
        ? s3Get(cfg, objectPath || mainPath)
        : webdavGet(cfg, objectPath || mainPath)
    };
  }

  async function testConnection(cfg) {
    if (cfg.provider === 's3') {
      if (!cfg.s3_endpoint || !cfg.s3_bucket || !cfg.s3_access_key || !cfg.s3_secret_key) {
        return { ok: false, error: 'S3 配置不完整' };
      }
      const objectPath = String(cfg.remote_path || 'world-books-backup.json').replace(/^\/+/, '');
      const qs = '?list-type=2&max-keys=1&prefix=' + encodeURIComponent(objectPath);
      const endpoint = String(cfg.s3_endpoint || '').trim().replace(/\/+$/, '');
      const region = String(cfg.s3_region || 'us-east-1').trim();
      const date = now();
      const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);
      const canonicalUri = '/' + s3EncodePath(String(cfg.s3_bucket || ''));
      const payloadHash = s3Sha256hex('');
      const host = new URL(endpoint).host;
      const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
      const canonicalHeaders = Object.keys(headers).sort().map(key => key + ':' + headers[key]).join('\n') + '\n';
      const signedHeaders = Object.keys(headers).sort().join(';');
      const canonicalRequest = ['GET', canonicalUri, qs.slice(1), canonicalHeaders, signedHeaders, payloadHash].join('\n');
      const scope = dateStamp + '/' + region + '/s3/aws4_request';
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, s3Sha256hex(canonicalRequest)].join('\n');
      const kDate = s3Hmac('AWS4' + cfg.s3_secret_key, dateStamp);
      const kRegion = s3Hmac(kDate, region);
      const kService = s3Hmac(kRegion, 's3');
      const kSigning = s3Hmac(kService, 'aws4_request');
      const signature = cryptoImpl.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
      const auth = 'AWS4-HMAC-SHA256 Credential=' + cfg.s3_access_key + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
      try {
        const response = await fetchImpl(endpoint + canonicalUri + qs, {
          headers: { Authorization: auth, 'X-Amz-Date': amzDate, 'x-amz-content-sha256': payloadHash }
        });
        if (!response.ok) return { ok: false, error: 'S3 连接失败 ' + response.status + ': ' + (await response.text()).slice(0, 160) };
        return { ok: true };
      } catch (error) {
        return { ok: false, error: 'S3 连接失败: ' + error.message };
      }
    }

    if (!cfg.webdav_url) return { ok: false, error: 'WebDAV 配置不完整' };
    try {
      const response = await fetchImpl(webdavTarget(cfg), { method: 'HEAD', headers: { ...webdavAuthHeader(cfg) } });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'WebDAV 认证失败（' + response.status + '）' };
      }
      if (response.ok || response.status === 404) return { ok: true };
      return { ok: false, error: 'WebDAV 连接异常 ' + response.status };
    } catch (error) {
      return { ok: false, error: 'WebDAV 连接失败: ' + error.message };
    }
  }

  return {
    action,
    testConnection,
    webdavAuthHeader,
    webdavTarget,
    webdavPut,
    webdavGet,
    s3Sha256hex,
    s3Hmac,
    s3EncodePath,
    s3Headers,
    s3ObjectUrl,
    s3Put,
    s3Get
  };
}

module.exports = { createCloudTransports };
