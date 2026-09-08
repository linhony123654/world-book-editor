# World Book Editor — Lore Atlas V2 Refactor

## Goal

Refactor the interface from a 430px magazine-shaped application into a responsive lore workspace while preserving the proven World Book JSON model, SQLite persistence, authentication, AI proxy contracts, import/export and version history.

The work is staged behind stable interfaces so presentation, domain and AI orchestration risks can be validated independently.

## Phase A — Workspace / visual system

The interface has been rebuilt as a responsive **Lore Atlas / editorial archive workspace**.

- `public/style.css` is now an import manifest rather than a monolith.
- Styling is separated into tokens, base, shell, library, editor, chat, surfaces, compatibility and responsive layers.
- Desktop >=1080px becomes a persistent workspace rather than a centered phone shell.
- Library behaves as a World Index; Editor becomes writing canvas + sticky inspector; AI becomes a wider editorial working document.
- Mobile preserves bottom navigation, sequential editing and bottom-sheet interaction.
- Existing DOM IDs and runtime contracts remain compatible.

## Phase B — Domain command architecture

All migrated world-book mutations now share one command boundary:

`Command -> Undo snapshot -> Apply -> live state sync -> domain event -> autosave`

Core modules:

- `public/modules/domain/worldbook-commands.js` — pure mutation semantics.
- `public/modules/domain/command-runtime.js` — browser state / undo integration.

Supported command semantics include:

- create / delete / duplicate entries;
- field updates, single-entry patch and atomic patch-many;
- primary / secondary keyword changes;
- import merge with UID reassignment and duplicate skipping;
- atomic merge-existing;
- atomic split-entry.

Migrated callers:

- Editor create/delete/duplicate/field/keyword paths;
- Library batch constant/enable/disable/delete;
- import merge;
- mutating AI tools.

AI turn rollback is deliberately distinct from per-command undo. Read-only AI tools no longer create fake undo snapshots.

## Phase C — AI modularization

`chat.js` is being reduced from a catch-all module into a controller over explicit AI boundaries.

### Transport and conversation protocol

- `public/modules/ai/transport.js`
  - OpenAI-compatible SSE parsing;
  - local `/api/proxy/chat` streaming request.
- `public/modules/ai/conversation/engine.js`
  - dependency-injected conversation/tool round loop;
  - native tool-call pairing;
  - textual tool-call fallback orchestration;
  - malformed argument isolation;
  - preview-stop and max-round outcomes;
  - tool trace / change aggregation.
- `public/modules/ai/conversation/budget.js`
  - token aggregation;
  - history folding without orphaning tool results;
  - tool-result truncation.

`sendChat()` now delegates the protocol loop to `runConversationTurn()` while keeping the main streamed DOM adapter in `chat.js`.

### Tool boundaries

- `public/modules/ai/tools/definitions.js`
  - canonical function-calling schemas.
- `public/modules/ai/tools/text-tool-parser.js`
  - fallback parsing for gateways that emit textual tool calls;
  - tool-call stripping from visible assistant text.
- `public/modules/ai/tools/worldbook-read.js`
  - pure search/filter/list;
  - duplicate detection;
  - health checks;
  - trigger simulation;
  - book summary analysis.

Mutating AI tools translate AI arguments into the same World Book Commands used by human and batch editing. `chat.js` no longer directly writes `worldBook.entries[...]`.

### Session and memory boundaries

- `public/modules/ai/session/model.js`
  - session creation and selection;
  - visible-message restoration;
  - fallback title rules;
  - session pruning;
  - memory normalization and limits;
  - token accumulation.
- `public/modules/ai/session/repository.js`
  - `/api/ai-data/:bookId` reads;
  - serialized whole-document PUTs;
  - auth-header injection;
  - write-error isolation so one failed save does not poison the queue.
- `public/modules/ai/memory/policy.js`
  - per-turn memory records;
  - normal/tight memory injection;
  - legacy 6500-character detail budget;
  - ten-turn rollup planning;
  - rollup application.
- `public/modules/ai/auxiliary-client.js`
  - 60-second bounded background completions;
  - title generation;
  - memory rollups;
  - writing-template and other non-primary completion callers.

The mutable session/UI lifecycle still lives in `chat.js`, but model semantics, persistence, memory policy and auxiliary transport are no longer implemented there.

### Chat presentation

- `public/modules/ai/ui/markdown.js`
  - escaped Markdown rendering;
  - URL protocol allow-list behavior.

The remaining DOM-heavy message/reasoning/tool-trace/composer rendering remains in `chat.js` for the next gate.

## Regression protection

Long-term CI is `.github/workflows/ci.yml` and runs:

1. `npm ci`;
2. `node --check public/modules/chat.js`;
3. `node --check public/app.js`;
4. `npm test`.

The explicit parse check was added after an intermediate guarded migration exposed duplicate top-level declarations that unit tests alone did not catch.

Architecture/regression suites now cover:

- command UID and structural invariants;
- no-op behavior and atomic patches;
- merge / split semantics;
- AI command-boundary enforcement;
- SSE chunk parsing;
- conversation-engine native/text tool protocol behavior;
- tool-schema / canonical-name synchronization;
- textual tool-call parsing;
- conversation budget pairing rules;
- Markdown escaping and unsafe-link rejection;
- read-only world-book search, diagnostics, trigger ordering and legacy parity;
- session creation, restore, pruning and memory-limit semantics;
- serialized session repository writes and error recovery;
- memory injection and rollup planning;
- auxiliary completion timeout / abort behavior;
- source-level boundary tests preventing migrated responsibilities from drifting back into `chat.js`.

Temporary one-shot migration workflows/scripts are deleted after generated changes pass syntax, architecture and regression checks. After each guarded migration, the repository returns to its normal `.github/workflows/ci.yml` plus original `scripts/backup.js` state.

## Compatibility invariants

The refactor currently preserves:

- World Book JSON schema and entry field names;
- `/api/books` request/response formats;
- auth token behavior;
- AI proxy wire formats;
- localStorage keys;
- SQLite tables/data;
- version/history persistence semantics;
- import/export file format.

## Current checkpoint

The AI path is now layered as:

`Chat Controller -> Conversation Engine -> Tool Adapter -> World Book Command`

with orthogonal services:

`Session Model -> Session Repository`

`Memory Policy -> Auxiliary Completion Client`

The primary streamed response path stays separate because it must incrementally update assistant text and reasoning UI.

## Remaining engineering gates

### Gate 1 — Tool execution adapters

Extract the remaining `chat.js` tool dispatch concerns behind dependency-injected adapters:

- mutating world-book tool adapters;
- world-book-level tools;
- web-search/proxy tool;
- smart-draft orchestration.

The domain command layer remains the only world-book mutation authority.

### Gate 2 — Legacy session migration boundary

Move old localStorage -> SQLite migration and corrupt-data backup rules out of `chat.js` while preserving all existing storage keys and one-time migration behavior.

### Gate 3 — Chat UI boundaries

Extract remaining DOM-specific concerns:

- message rendering/edit/resend;
- reasoning stream view;
- tool trace / change cards;
- composer, scrolling and generation controls.

### Gate 4 — Application shell

Split `app.js` into:

- boot/navigation shell;
- settings and API-profile management;
- history/version orchestration;
- account/cloud surfaces.

### Gate 5 — Server boundaries

Split `server.js` into route/service/repository boundaries for:

- auth;
- books;
- versions;
- AI proxy/search;
- AI data/session persistence;
- cloud/storage operations.

HTTP and database contracts remain unchanged while responsibilities move.

## Rule for the remaining refactor

Each boundary is moved only after its behavior is characterized by tests. Generated migrations must parse successfully, pass the full suite, and remove temporary scaffolding before the next high-risk boundary is changed.
