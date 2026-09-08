import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiProfileRepository, normalizeImportedProfiles } from '../public/modules/app/api-profiles.js';

function makeStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    dump() { return Object.fromEntries(data); }
  };
}

test('load tolerates malformed profile JSON and falls back to empty when no legacy config exists', () => {
  const storage = makeStorage({ 'wbe-api-profiles': '{broken' });
  const repo = createApiProfileRepository({ storage });
  assert.deepEqual(repo.load(), []);
});

test('load migrates legacy single API config into one default profile exactly once', () => {
  const storage = makeStorage({
    'wbe-api-url': 'https://api.example/v1',
    'wbe-api-key': 'secret',
    'wbe-model': 'gpt-test',
    'wbe-system-prompt': 'system'
  });
  const repo = createApiProfileRepository({ storage, now: () => 12345 });

  assert.deepEqual(repo.load(), [{
    id: 'p12345',
    name: '默认配置',
    url: 'https://api.example/v1',
    key: 'secret',
    model: 'gpt-test',
    prompt: 'system'
  }]);
  assert.equal(storage.getItem('wbe-api-active'), 'p12345');

  storage.setItem('wbe-api-url', 'https://changed.example');
  assert.equal(repo.load()[0].url, 'https://api.example/v1');
});

test('setActive mirrors the selected profile to legacy keys and notifies once', () => {
  const storage = makeStorage({
    'wbe-api-profiles': JSON.stringify([
      { id: 'a', name: 'A', url: 'https://a', key: 'ka', model: 'ma', prompt: 'pa' },
      { id: 'b', name: 'B', url: 'https://b', key: 'kb', model: 'mb', prompt: 'pb' }
    ])
  });
  const changes = [];
  const repo = createApiProfileRepository({ storage, onActiveChanged: profile => changes.push(profile?.id || null) });

  const active = repo.setActive('b');
  assert.equal(active.id, 'b');
  assert.equal(repo.activeId(), 'b');
  assert.equal(storage.getItem('wbe-api-url'), 'https://b');
  assert.equal(storage.getItem('wbe-api-key'), 'kb');
  assert.equal(storage.getItem('wbe-model'), 'mb');
  assert.equal(storage.getItem('wbe-system-prompt'), 'pb');
  assert.deepEqual(changes, ['b']);
});

test('setActive ignores unknown ids without changing active profile', () => {
  const storage = makeStorage({
    'wbe-api-active': 'a',
    'wbe-api-profiles': JSON.stringify([{ id: 'a', url: 'https://a' }])
  });
  const repo = createApiProfileRepository({ storage });
  assert.equal(repo.setActive('missing'), null);
  assert.equal(repo.activeId(), 'a');
});

test('clearActive removes active id and clears all legacy mirrors', () => {
  const storage = makeStorage({
    'wbe-api-active': 'a',
    'wbe-api-url': 'u',
    'wbe-api-key': 'k',
    'wbe-model': 'm',
    'wbe-system-prompt': 'p'
  });
  const repo = createApiProfileRepository({ storage });
  repo.clearActive({ notify: false });
  assert.equal(repo.activeId(), '');
  assert.equal(storage.getItem('wbe-api-url'), '');
  assert.equal(storage.getItem('wbe-api-key'), '');
  assert.equal(storage.getItem('wbe-model'), '');
  assert.equal(storage.getItem('wbe-system-prompt'), '');
});

test('normalizeImportedProfiles preserves only entries with id and url', () => {
  assert.deepEqual(normalizeImportedProfiles([
    null,
    { id: '', url: 'x' },
    { id: 'a', url: '' },
    { id: 'ok', url: 'https://ok', name: 'OK' }
  ]), [{ id: 'ok', url: 'https://ok', name: 'OK' }]);
});

test('replaceImported chooses requested active when valid, otherwise first valid profile', () => {
  const storage = makeStorage();
  const repo = createApiProfileRepository({ storage });
  const profiles = [
    { id: 'a', url: 'https://a', key: 'ka' },
    { id: 'b', url: 'https://b', key: 'kb' }
  ];

  let result = repo.replaceImported(profiles, 'b', { notify: false });
  assert.equal(result.active.id, 'b');
  assert.equal(repo.activeId(), 'b');
  assert.equal(storage.getItem('wbe-api-url'), 'https://b');

  result = repo.replaceImported(profiles, 'missing', { notify: false });
  assert.equal(result.active.id, 'a');
  assert.equal(repo.activeId(), 'a');
});
