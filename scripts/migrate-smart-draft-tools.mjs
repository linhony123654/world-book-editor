import fs from 'node:fs';

const chatPath = 'public/modules/chat.js';
let chat = fs.readFileSync(chatPath, 'utf8');

const mutationImport = "import { WORLD_BOOK_MUTATION_TOOL_NAMES, createWorldBookMutationHandlers } from './ai/tools/worldbook-mutation.js';\n";
const smartImport = "import { createSmartDraftOrchestrator } from './ai/tools/smart-draft.js';\n";
if (!chat.includes(smartImport)) {
  if (!chat.includes(mutationImport)) throw new Error('mutation import anchor missing');
  chat = chat.replace(mutationImport, mutationImport + smartImport);
}

chat = chat.replace("import { planWorldbookEntry } from './worldbook-intelligence/index.js';\n", '');
chat = chat.replace("import { TEMPLATES } from './worldbook-intelligence/templates.js';\n", '');
chat = chat.replace(
  "import { applyDraftToEntry, createSmartDraftRecord, draftDisplayRows, formatDecision } from './smart-draft.js';",
  "import { draftDisplayRows } from './smart-draft.js';"
);
chat = chat.replace(
  "import { WRITING_TEMPLATE_FIELDS, applyWritingTemplateUpdate, buildWritingTemplateGenerationMessages, formatWritingTemplateForTool, loadWritingTemplate, parseWritingTemplateDraft, saveWritingTemplate, selectWritingTemplate, writingTemplateKey } from './writing-template.js';",
  "import { WRITING_TEMPLATE_FIELDS, applyWritingTemplateUpdate, buildWritingTemplateGenerationMessages, formatWritingTemplateForTool, loadWritingTemplate, parseWritingTemplateDraft, saveWritingTemplate, writingTemplateKey } from './writing-template.js';"
);
chat = chat.replace("import { CommandType } from './domain/worldbook-commands.js';\n", '');

const registryAnchor = 'dispatchTool = createToolExecutor({\n';
const orchestratorBlock = `const smartDraftOrchestrator = createSmartDraftOrchestrator({
  getEntries: getAllEntries,
  getWritingTemplate: () => loadWritingTemplate(localStorage, currentBookId),
  completeAuxiliary,
  nextUid,
  createEntry,
  runCommand: runWorldBookCommand,
  renderSidebar,
  scheduleSave,
  setActiveDraft: record => setActiveSmartDraft(smartDraftState, record),
  showDraftPreview: renderSmartDraftModal,
  onCompletionError: error => console.warn('[WBE] 正文补全失败，保留原草稿:', error.message)
});

`;
if (!chat.includes(registryAnchor)) throw new Error('registry anchor missing');
if (!chat.includes('const smartDraftOrchestrator = createSmartDraftOrchestrator')) {
  chat = chat.replace(registryAnchor, orchestratorBlock + registryAnchor);
}

if (!chat.includes('    plan_smart_entry: toolPlanSmartEntry,\n')) throw new Error('legacy plan_smart_entry registration missing');
if (!chat.includes('    create_smart_entry: toolCreateSmartEntry,\n')) throw new Error('legacy create_smart_entry registration missing');
chat = chat.replace('    plan_smart_entry: toolPlanSmartEntry,\n', '');
chat = chat.replace('    create_smart_entry: toolCreateSmartEntry,\n', '');
const writingAnchor = '    update_writing_template: toolUpdateWritingTemplate,\n';
if (!chat.includes(writingAnchor)) throw new Error('writing-template registry anchor missing');
chat = chat.replace(writingAnchor, writingAnchor + '    ...smartDraftOrchestrator.handlers,\n');

function removeBetween(startMarker, endMarker, label) {
  const start = chat.indexOf(startMarker);
  if (start < 0) throw new Error(label + ' start marker missing');
  const end = chat.indexOf(endMarker, start);
  if (end < 0) throw new Error(label + ' end marker missing');
  chat = chat.slice(0, start) + chat.slice(end);
}

removeBetween('async function toolCreateSmartEntry(args) {', 'function toolGetWritingTemplate(args) {', 'smart draft plan/completion block');
removeBetween('function withWritingTemplate(args) {', 'function renderSmartDraftModal(record) {', 'smart draft commit/detail block');

const oldCommitCall = '  const result = commitSmartDraft(record.draft);';
if (!chat.includes(oldCommitCall)) throw new Error('manual smart draft commit call missing');
chat = chat.replace(oldCommitCall, '  const result = smartDraftOrchestrator.commitDraft(record.draft);');

const forbidden = [
  'function toolCreateSmartEntry(',
  'function toolPlanSmartEntry(',
  'function checkRelatedEntries(',
  'async function maybeCompleteSmartContent(',
  'function withWritingTemplate(',
  'function commitSmartDraft(',
  'function checkNewEntry(',
  'function smartDraftDetail(',
  'PLACEHOLDER_RE ='
];
for (const token of forbidden) {
  if (chat.includes(token)) throw new Error('legacy smart-draft implementation remains: ' + token);
}
if (!chat.includes('...smartDraftOrchestrator.handlers')) throw new Error('smart draft handler spread missing');
if (!chat.includes('smartDraftOrchestrator.commitDraft(record.draft)')) throw new Error('manual confirm does not reuse orchestrator commit');

fs.writeFileSync(chatPath, chat);

fs.writeFileSync('tests/chat-smart-draft-boundary.test.mjs', `import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chat = fs.readFileSync(new URL('../public/modules/chat.js', import.meta.url), 'utf8');

test('chat delegates smart-draft planning, completion and commit semantics', () => {
  assert.match(chat, /from '\\.\\/ai\\/tools\\/smart-draft\\.js'/);
  assert.match(chat, /createSmartDraftOrchestrator\\s*\\(/);
  assert.match(chat, /\\.\\.\\.smartDraftOrchestrator\\.handlers/);
  assert.doesNotMatch(chat, /function toolCreateSmartEntry\\s*\\(/);
  assert.doesNotMatch(chat, /function toolPlanSmartEntry\\s*\\(/);
  assert.doesNotMatch(chat, /async function maybeCompleteSmartContent\\s*\\(/);
  assert.doesNotMatch(chat, /function commitSmartDraft\\s*\\(/);
});

test('chat keeps smart-draft DOM state as the controller adapter', () => {
  assert.match(chat, /function renderSmartDraftModal\\s*\\(/);
  assert.match(chat, /function commitActiveSmartDraft\\s*\\(/);
  assert.match(chat, /function discardActiveSmartDraft\\s*\\(/);
  assert.match(chat, /smartDraftOrchestrator\\.commitDraft\\(record\\.draft\\)/);
});
`);

console.log('Migrated smart-draft orchestration out of chat.js');
