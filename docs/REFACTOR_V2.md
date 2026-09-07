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
- mutating AI tools in `chat.js`.

AI turn rollback is deliberately distinct from per-command undo. Read-only AI tools no longer create fake undo snapshots.

## Phase C — AI module extraction

`chat.js` is being reduced from a catch-all module into orchestration over explicit AI boundaries.

Extracted modules:

- `public/modules/ai/transport.js`
  - OpenAI-compatible SSE parsing;
  - local `/api/proxy/chat` streaming request.
- `public/modules/ai/tools/definitions.js`
  - canonical function-calling schemas;
  - cached tool definition registry.
- `public/modules/ai/tools/text-tool-parser.js`
  - fallback parsing for gateways that emit textual tool calls;
  - tool-call stripping from visible assistant text.
- `public/modules/ai/tools/worldbook-read.js`
  - pure search/filter/list;
  - duplicate detection;
  - health checks;
  - trigger simulation;
  - book summary analysis.
- `public/modules/ai/conversation/budget.js`
  - token estimation aggregation;
  - history folding without orphaning tool results;
  - tool-result truncation.
- `public/modules/ai/ui/markdown.js`
  - escaped Markdown rendering;
  - URL protocol allow-list behavior.

Mutating AI tools now translate AI arguments into the same World Book Commands used by human and batch editing. `chat.js` no longer directly writes `worldBook.entries[...]`.

## Regression protection

Long-term CI is `.github/workflows/ci.yml` and runs `npm ci` + `npm test` on Node 22.

Added architecture/regression suites cover:

- command UID and structural invariants;
- no-op behavior and atomic patches;
- merge / split semantics;
- AI command-boundary enforcement;
- SSE chunk parsing;
- tool-schema / canonical-name synchronization;
- textual tool-call parsing;
- conversation budget pairing rules;
- Markdown escaping and unsafe-link rejection;
- read-only world-book search, diagnostics, trigger ordering and behavioral parity.

Temporary migration workflows/scripts used to safely rewrite the former ~160 KB `chat.js` are removed after their generated changes pass CI; they are not part of the product architecture.

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

## Remaining engineering gates

### Gate 1 — Conversation / tool execution boundaries

Split the remaining `chat.js` responsibilities behind dependency-injected interfaces:

- conversation turn engine / tool loop;
- mutating tool executor adapters;
- world-book-level tools;
- smart-draft orchestration.

### Gate 2 — Session and memory boundaries

Extract:

- session repository and active-session lifecycle;
- memory persistence / migration;
- rollup summarization;
- auxiliary completion requests and title generation.

### Gate 3 — Chat UI boundaries

Extract remaining DOM-specific concerns:

- message rendering and editing actions;
- reasoning stream view;
- tool trace / change cards;
- composer and scroll behavior.

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

HTTP and database contracts remain unchanged until dedicated migration tests exist.
