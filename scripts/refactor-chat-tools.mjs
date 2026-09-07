import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
const toolsDir = 'public/modules/ai/tools';
const definitionsPath = toolsDir + '/definitions.js';
const parserPath = toolsDir + '/text-tool-parser.js';
let src = fs.readFileSync(chatPath, 'utf8');
fs.mkdirSync(toolsDir, { recursive: true });

const definitionsStart = '// ===== AI 工具定义 =====';
const parserStart = '// ===== 检测文本是否包含工具调用 =====';
const executeStart = 'async function executeTool(name, args) {';

// Already migrated: only validate the stable boundary.
if (!src.includes(definitionsStart) && !src.includes(parserStart)) {
  if (!fs.existsSync(definitionsPath) || !fs.existsSync(parserPath)) throw new Error('tool modules missing after prior migration');
  if (!src.includes("from './ai/tools/definitions.js'")) throw new Error('definitions import missing');
  if (!src.includes("from './ai/tools/text-tool-parser.js'")) throw new Error('parser import missing');
  console.log('chat tool extraction already applied');
  process.exit(0);
}

const defStart = src.indexOf(definitionsStart);
const parseStart = src.indexOf(parserStart);
const execStart = src.indexOf(executeStart);
if (defStart < 0 || parseStart < 0 || execStart < 0 || !(defStart < parseStart && parseStart < execStart)) {
  throw new Error('tool extraction markers are inconsistent');
}

let definitionsBlock = src.slice(defStart, parseStart).trim();
definitionsBlock = definitionsBlock
  .replace('function buildToolsList() {', 'export function buildToolsList() {')
  .replace('function getTools() {', 'export function getTools() {')
  .replace('function smartEntryParameters() {', 'export function smartEntryParameters() {');
const definitionsModule = [
  "import { TOOL_NAMES } from '../../tool-names.js';",
  '',
  '// Static OpenAI-compatible tool schemas. This module must stay free of DOM and conversation state.',
  definitionsBlock,
  ''
].join('\n');
fs.writeFileSync(definitionsPath, definitionsModule);

let parserBlock = src.slice(parseStart, execStart).trim();
parserBlock = parserBlock
  .replace('function hasToolCall(text) {', 'export function hasToolCall(text) {')
  .replace('function parseTextToolCalls(text) {', 'export function parseTextToolCalls(text) {')
  .replace('function stripToolCalls(text) {', 'export function stripToolCalls(text) {');
const parserModule = [
  "import { TOOL_NAMES, TOOL_NAME_PATTERN } from '../../tool-names.js';",
  '',
  '// Text-format fallback parser for gateways that do not return native tool_calls.',
  "const TOOL_CALL_JSON_RE = new RegExp('\\\\{\\\\s*\"name\"\\\\s*:\\\\s*\"(' + TOOL_NAME_PATTERN + ')\"\\\\s*,\\\\s*\"arguments\"\\\\s*:\\\\s*(\\\\{[\\\\s\\\\S]*?\\\\})\\\\s*\\\\}', 'g');",
  "const TOOL_FN_RE = new RegExp('\\\\b(' + TOOL_NAME_PATTERN + ')\\\\s*\\\\(([^)]*)\\\\)', 'g');",
  "const TOOL_CALL_JSON_STRIP_RE = new RegExp('\\\\{\\\\s*\"name\"\\\\s*:\\\\s*\"(' + TOOL_NAME_PATTERN + ')\"\\\\s*,\\\\s*\"arguments\"\\\\s*:\\\\s*\\\\{[\\\\s\\\\S]*?\\\\}\\\\s*\\\\}', 'g');",
  '',
  parserBlock,
  ''
].join('\n');
fs.writeFileSync(parserPath, parserModule);

// Remove the static tool definitions and parser implementations from chat.js.
src = src.slice(0, defStart) + src.slice(execStart);

// Remove parser-only imports and regex state from chat.js.
src = src.replace("import { TOOL_NAMES, TOOL_NAME_PATTERN } from './tool-names.js';\n", '');
const regexStartMarker = '// 工具调用文本格式的正则都从 TOOL_NAME_PATTERN 派生，名单单一来源，避免多处重复漂移';
const smartDraftMarker = 'const smartDraftState = createSmartDraftState();';
const regexStart = src.indexOf(regexStartMarker);
const smartDraftAt = src.indexOf(smartDraftMarker);
if (regexStart >= 0) {
  if (smartDraftAt < 0 || smartDraftAt <= regexStart) throw new Error('smart draft marker missing after parser regex block');
  src = src.slice(0, regexStart) + src.slice(smartDraftAt);
}

const commandAnchor = "import { CommandType } from './domain/worldbook-commands.js';\n";
if (!src.includes(commandAnchor)) throw new Error('command import anchor missing');
const toolImports = "import { getTools } from './ai/tools/definitions.js';\nimport { parseTextToolCalls, stripToolCalls } from './ai/tools/text-tool-parser.js';\n";
if (!src.includes("from './ai/tools/definitions.js'")) src = src.replace(commandAnchor, commandAnchor + toolImports);

if (src.includes('function buildToolsList()')) throw new Error('tool definitions still live in chat.js');
if (src.includes('function smartEntryParameters()')) throw new Error('smartEntryParameters still lives in chat.js');
if (src.includes('function parseTextToolCalls(')) throw new Error('text tool parser still lives in chat.js');
if (src.includes('TOOL_NAME_PATTERN')) throw new Error('parser-only TOOL_NAME_PATTERN leaked into chat.js');
if (!src.includes('getTools()')) throw new Error('conversation engine lost getTools call');
if (!src.includes('parseTextToolCalls(') || !src.includes('stripToolCalls(')) throw new Error('conversation engine lost parser calls');

fs.writeFileSync(chatPath, src);
console.log('chat tool definitions and parser extracted');
