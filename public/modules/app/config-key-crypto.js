const DEFAULT_ITERATIONS = 200000;
const FORMAT_PREFIX = 'wbe1';

function requireCrypto(cryptoImpl) {
  if (!cryptoImpl?.subtle || typeof cryptoImpl.getRandomValues !== 'function') {
    throw new TypeError('Config key crypto requires Web Crypto');
  }
  return cryptoImpl;
}

function bytesToBase64(bytes, btoaImpl) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoaImpl(binary);
}

function base64ToBytes(value, atobImpl) {
  const binary = atobImpl(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveKey(password, salt, { cryptoImpl, iterations }) {
  const cryptoApi = requireCrypto(cryptoImpl);
  const encoder = new TextEncoder();
  const material = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return cryptoApi.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptConfigKey(payloadJson, password, {
  cryptoImpl = globalThis.crypto,
  btoaImpl = globalThis.btoa,
  iterations = DEFAULT_ITERATIONS
} = {}) {
  const cryptoApi = requireCrypto(cryptoImpl);
  if (typeof btoaImpl !== 'function') throw new TypeError('Config key crypto requires btoa');

  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, { cryptoImpl: cryptoApi, iterations });
  const plaintext = new TextEncoder().encode(String(payloadJson));
  const ciphertext = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return [
    FORMAT_PREFIX,
    bytesToBase64(salt, btoaImpl),
    bytesToBase64(iv, btoaImpl),
    bytesToBase64(new Uint8Array(ciphertext), btoaImpl)
  ].join(':');
}

export async function decryptConfigKey(keyString, password, {
  cryptoImpl = globalThis.crypto,
  atobImpl = globalThis.atob,
  iterations = DEFAULT_ITERATIONS
} = {}) {
  const cryptoApi = requireCrypto(cryptoImpl);
  if (typeof atobImpl !== 'function') throw new TypeError('Config key crypto requires atob');

  const parts = String(keyString || '').split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX || parts.slice(1).some(part => !part)) {
    throw new Error('bad key');
  }

  const salt = base64ToBytes(parts[1], atobImpl);
  const iv = base64ToBytes(parts[2], atobImpl);
  const ciphertext = base64ToBytes(parts[3], atobImpl);
  const key = await deriveKey(password, salt, { cryptoImpl: cryptoApi, iterations });
  const plaintext = await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export function decodeLegacyConfigKey(raw, { atobImpl = globalThis.atob } = {}) {
  if (typeof atobImpl !== 'function') throw new TypeError('Legacy config key decode requires atob');
  const text = String(raw || '').trim();
  const payload = text.startsWith('wbe:') ? text.slice(4) : text;
  if (!payload) throw new Error('bad key');
  const bytes = base64ToBytes(payload.trim(), atobImpl);
  return new TextDecoder().decode(bytes);
}

export function isEncryptedConfigKey(raw) {
  return String(raw || '').startsWith(FORMAT_PREFIX + ':');
}

export const CONFIG_KEY_FORMAT = Object.freeze({
  prefix: FORMAT_PREFIX,
  iterations: DEFAULT_ITERATIONS,
  saltBytes: 16,
  ivBytes: 12,
  kdf: 'PBKDF2-SHA-256',
  cipher: 'AES-GCM-256'
});
