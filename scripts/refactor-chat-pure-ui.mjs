import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
const budgetPath = 'public/modules/ai/conversation/budget.js';
const markdownPath = 'public/modules/ai/ui/markdown.js';
let src = fs.readFileSync(chatPath, 'utf8');
fs.mkdirSync('public/modules/ai/conversation', { recursive: true });
fs.mkdirSync('public/modules/ai/ui', { recursive: true });

const budgetImport = "import { countMessagesTokens, trimToBudget, truncateToolDetail } from './ai/conversation/budget.js';\n";
const markdownImport = "import { formatChatText } from './ai/ui/markdown.js';\n";

if (src.includes(budgetImport.trim()) && src.includes(markdownImport.trim())) {
  if (!fs.existsSync(budgetPath) || !fs.existsSync(markdownPath)) throw new Error('pure AI modules missing after prior migration');
  console.log('conversation budget and markdown extraction already applied');
  process.exit(0);
}

const budgetStartMarker = '// 估算整组消息的 token 总数（含 tool_calls 的 JSON 序列化）';
const genIdMarker = 'function genToolCallId() {';
const truncateMarker = '// 工具结果 detail 截断：防止全量进 messages 导致上下文平方级膨胀';
const safeMarker = '// 单个工具执行异常隔离：出错时把错误消息作为结果返回给模型，继续后续工具';
const markdownStartMarker = '// ===== 格式化聊天文本（简单 markdown） =====';
const scrollMarker = '// ===== 聊天滚动 =====';

const budgetStart = src.indexOf(budgetStartMarker);
const genIdAt = src.indexOf(genIdMarker, budgetStart);
const truncateAt = src.indexOf(truncateMarker, genIdAt);
const safeAt = src.indexOf(safeMarker, truncateAt);
const markdownStart = src.indexOf(markdownStartMarker);
const scrollAt = src.indexOf(scrollMarker, markdownStart);
if ([budgetStart, genIdAt, truncateAt, safeAt, markdownStart, scrollAt].some(i => i < 0)) {
  throw new Error('pure module extraction markers missing');
}

let budgetCore = src.slice(budgetStart, genIdAt).trim();
let truncateCore = src.slice(truncateAt, safeAt).trim();
budgetCore = budgetCore
  .replace('function countMessagesTokens(messages) {', 'export function countMessagesTokens(messages) {')
  .replace('function trimToBudget(messages, budget) {', 'export function trimToBudget(messages, budget) {');
truncateCore = truncateCore.replace('function truncateToolDetail(detail) {', 'export function truncateToolDetail(detail, maxLength = 800) {')
  .replace('d.length > TOOL_DETAIL_MAX ? d.slice(0, TOOL_DETAIL_MAX)', 'd.length > maxLength ? d.slice(0, maxLength)');
const budgetModule = [
  "import { estimateTokens } from '../../utils.js';",
  '',
  '// Pure conversation budget helpers. No DOM, storage or mutable chat state.',
  budgetCore,
  '',
  truncateCore,
  ''
].join('\n');
fs.writeFileSync(budgetPath, budgetModule);

let markdownCore = src.slice(markdownStart, scrollAt).trim();
markdownCore = markdownCore
  .replace('function mdInline(s) {', 'export function mdInline(s) {')
  .replace('function formatChatText(text) {', 'export function formatChatText(text) {');
const markdownModule = [
  "import { escHtml, escUrl } from '../../utils.js';",
  '',
  '// Chat Markdown renderer. Input is model/user text; all HTML/URLs must remain escaped here.',
  markdownCore,
  ''
].join('\n');
fs.writeFileSync(markdownPath, markdownModule);

// Remove extracted implementations from chat.js.
src = src.replace(src.slice(budgetStart, genIdAt), '');
// Recalculate after the first removal before removing truncate block.
const truncateAt2 = src.indexOf(truncateMarker);
const safeAt2 = src.indexOf(safeMarker, truncateAt2);
if (truncateAt2 < 0 || safeAt2 < 0) throw new Error('truncate block moved unexpectedly');
src = src.slice(0, truncateAt2) + src.slice(safeAt2);
const markdownStart2 = src.indexOf(markdownStartMarker);
const scrollAt2 = src.indexOf(scrollMarker, markdownStart2);
if (markdownStart2 < 0 || scrollAt2 < 0) throw new Error('markdown block moved unexpectedly');
src = src.slice(0, markdownStart2) + src.slice(scrollAt2);

src = src.replace("const TOOL_DETAIL_MAX = 800;        // 工具结果 detail 注入上下文的最大长度（搜索类结果足够，控制上下文膨胀）\n", '');
src = src.replace("import { escHtml, escAttr, escUrl, $, estimateTokens } from './utils.js';", "import { escHtml, escAttr, $ } from './utils.js';");

const parserAnchor = "import { parseTextToolCalls, stripToolCalls } from './ai/tools/text-tool-parser.js';\n";
if (!src.includes(parserAnchor)) throw new Error('parser import anchor missing');
if (!src.includes(budgetImport.trim())) src = src.replace(parserAnchor, parserAnchor + budgetImport + markdownImport);

if (src.includes('function countMessagesTokens(') || src.includes('function trimToBudget(') || src.includes('function truncateToolDetail(')) {
  throw new Error('conversation budget helpers still live in chat.js');
}
if (src.includes('function formatChatText(') || src.includes('function mdInline(')) throw new Error('markdown renderer still lives in chat.js');
if (src.includes('estimateTokens(')) throw new Error('estimateTokens should be owned by budget module');
if (src.includes('escUrl(')) throw new Error('escUrl should be owned by markdown module');
if (!src.includes('function genToolCallId()')) throw new Error('tool-call id generator was removed accidentally');

fs.writeFileSync(chatPath, src);
console.log('conversation budget and markdown renderer extracted');
