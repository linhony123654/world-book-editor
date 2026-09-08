import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
let chat = fs.readFileSync(chatPath, 'utf8');

const mutationImport = "import { WORLD_BOOK_MUTATION_TOOL_NAMES, createWorldBookMutationHandlers } from './ai/tools/worldbook-mutation.js';\n";
const searchImport = "import { createWebSearchTool } from './ai/tools/web-search.js';\n";
if (!chat.includes(searchImport)) {
  if (!chat.includes(mutationImport)) throw new Error('mutation import anchor missing');
  chat = chat.replace(mutationImport, mutationImport + searchImport);
}

const registryAnchor = 'dispatchTool = createToolExecutor({\n';
const searchAdapter = `const webSearchTool = createWebSearchTool({
  fetchImpl: (...args) => fetch(...args),
  getAuthHeaders: async () => {
    const { authHeaders } = await import('./auth.js');
    return authHeaders();
  }
});

`;
if (!chat.includes(registryAnchor)) throw new Error('registry anchor missing');
if (!chat.includes('const webSearchTool = createWebSearchTool')) {
  chat = chat.replace(registryAnchor, searchAdapter + registryAnchor);
}

if (!chat.includes('    web_search: toolWebSearch,\n')) throw new Error('legacy web_search registry entry missing');
chat = chat.replace('    web_search: toolWebSearch,\n', '    web_search: webSearchTool,\n');

const startMarker = '// ===== 联网搜索 =====\n';
const endMarker = 'function toolUndo(args) {';
const start = chat.indexOf(startMarker);
const end = chat.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('web search function boundaries missing');
chat = chat.slice(0, start) + chat.slice(end);

if (chat.includes('function toolWebSearch(')) throw new Error('legacy toolWebSearch remains');
if (chat.includes("fetch('/api/proxy/search'")) throw new Error('chat still directly calls search proxy');
if (!chat.includes('web_search: webSearchTool')) throw new Error('web search adapter not registered');
fs.writeFileSync(chatPath, chat);

const testPath = 'tests/chat-web-search-boundary.test.mjs';
fs.writeFileSync(testPath, `import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates web search HTTP/auth behavior to the web-search adapter', () => {
  assert.match(chat, /from '\\.\\/ai\\/tools\\/web-search\\.js'/);
  assert.match(chat, /createWebSearchTool\\s*\\(/);
  assert.match(chat, /web_search:\\s*webSearchTool/);
  assert.doesNotMatch(chat, /function toolWebSearch\\s*\\(/);
  assert.doesNotMatch(chat, /fetch\\(\\s*['\"]\\/api\\/proxy\\/search/);
});
`);

console.log('Migrated web_search HTTP/auth behavior out of chat.js');
