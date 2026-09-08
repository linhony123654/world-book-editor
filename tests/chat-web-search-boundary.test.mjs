import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates web search HTTP/auth behavior to the web-search adapter', () => {
  assert.match(chat, /from '\.\/ai\/tools\/web-search\.js'/);
  assert.match(chat, /createWebSearchTool\s*\(/);
  assert.match(chat, /web_search:\s*webSearchTool/);
  assert.doesNotMatch(chat, /function toolWebSearch\s*\(/);
  assert.doesNotMatch(chat, /fetch\(\s*['"]\/api\/proxy\/search/);
});
