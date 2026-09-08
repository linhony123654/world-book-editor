import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import {
  CONFIG_KEY_FORMAT,
  decodeLegacyConfigKey,
  decryptConfigKey,
  encryptConfigKey,
  isEncryptedConfigKey
} from '../public/modules/app/config-key-crypto.js';

const toB64 = binary => Buffer.from(binary, 'binary').toString('base64');
const fromB64 = value => Buffer.from(value, 'base64').toString('binary');

test('encrypted config key preserves wbe1 four-part envelope and protocol constants', async () => {
  const encrypted = await encryptConfigKey('{"hello":"世界"}', 'password', {
    cryptoImpl: webcrypto,
    btoaImpl: toB64,
    iterations: 1000
  });
  const parts = encrypted.split(':');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'wbe1');
  assert.equal(Buffer.from(parts[1], 'base64').length, 16);
  assert.equal(Buffer.from(parts[2], 'base64').length, 12);
  assert.equal(isEncryptedConfigKey(encrypted), true);
  assert.equal(CONFIG_KEY_FORMAT.iterations, 200000);
  assert.equal(CONFIG_KEY_FORMAT.kdf, 'PBKDF2-SHA-256');
  assert.equal(CONFIG_KEY_FORMAT.cipher, 'AES-GCM-256');
});

test('encrypt and decrypt round-trip UTF-8 profile payload', async () => {
  const payload = JSON.stringify({ p: [{ id: 'a', name: '中文', url: 'https://example' }], a: 'a', v: 1 });
  const encrypted = await encryptConfigKey(payload, 'correct horse', {
    cryptoImpl: webcrypto,
    btoaImpl: toB64,
    iterations: 1000
  });
  const decrypted = await decryptConfigKey(encrypted, 'correct horse', {
    cryptoImpl: webcrypto,
    atobImpl: fromB64,
    iterations: 1000
  });
  assert.equal(decrypted, payload);
});

test('decrypt rejects malformed envelope and wrong password', async () => {
  await assert.rejects(() => decryptConfigKey('wbe1:bad', 'x', {
    cryptoImpl: webcrypto,
    atobImpl: fromB64,
    iterations: 1000
  }), /bad key/);

  const encrypted = await encryptConfigKey('{"x":1}', 'right', {
    cryptoImpl: webcrypto,
    btoaImpl: toB64,
    iterations: 1000
  });
  await assert.rejects(() => decryptConfigKey(encrypted, 'wrong', {
    cryptoImpl: webcrypto,
    atobImpl: fromB64,
    iterations: 1000
  }));
});

test('legacy config key decoding accepts prefixed and raw base64 UTF-8 payloads', () => {
  const payload = JSON.stringify({ p: [{ id: 'a', url: 'https://例子.test' }], a: 'a' });
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  assert.equal(decodeLegacyConfigKey('wbe:' + encoded, { atobImpl: fromB64 }), payload);
  assert.equal(decodeLegacyConfigKey(encoded, { atobImpl: fromB64 }), payload);
  assert.equal(isEncryptedConfigKey('wbe:' + encoded), false);
});
