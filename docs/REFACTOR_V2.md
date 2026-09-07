# World Book Editor — Lore Atlas V2 Refactor

## Goal

Refactor the interface from a 430px magazine-shaped application into a responsive lore workspace while progressively separating domain mutations from UI, AI orchestration and persistence.

The core compatibility contract remains stable: World Book JSON, SQLite data, auth, API payloads, import/export and version history are not being destructively migrated.

## Phase A — Visual workspace refactor

### Design system architecture

`public/style.css` is reduced to an import manifest. Styling is split into:

- `styles/tokens.css` — semantic tokens, type stacks, light/dark palettes, motion constants.
- `styles/base.css` — resets, focus, selection, global material texture and reduced-motion behavior.
- `styles/shell.css` — app shell, masthead, navigation, login surface, toast.
- `styles/library.css` — world overview, search, taxonomy filters, statistics, entry index/grid, batch mode.
- `styles/editor.css` — writing canvas, keywords, inspector, advanced fields, actions.
- `styles/chat.css` — AI document, reasoning, tool trace, change cards, composer.
- `styles/surfaces.css` — archive, settings, profile, dialogs, memory, versions and diff surfaces.
- `styles/compat.css` — legacy secondary surfaces that still share the new visual language.
- `styles/responsive.css` — structural breakpoint transformations.

### Desktop workspace

At >=1080px the application no longer renders as a centered phone:

- bottom nav transforms into a persistent left rail;
- Library becomes a two-field workspace: sticky world identity / live entry field;
- Editor becomes writing canvas + sticky property inspector;
- AI chat gets a wide editorial reading measure and floating composer;
- modal sheets become centered dialogs.

### Mobile preservation

Below desktop width:

- the existing bottom-navigation model is preserved;
- dialogs remain bottom sheets;
- editor reverts to a sequential composition;
- entry grids collapse from two columns to one on narrow phones;
- the visual identity remains intact instead of falling back to a generic mobile dashboard.

## Phase B — Domain command architecture (in progress)

The first engineering pass is now implemented under `public/modules/domain/`.

### Pure command core

`worldbook-commands.js` owns mutation semantics without importing DOM, storage, autosave or UI code.

Supported commands currently include:

- create entry;
- delete one/many entries;
- duplicate entry;
- set one field across one/many entries;
- patch one/many entries atomically;
- add/remove keywords;
- import/merge incoming entries with UID reassignment and duplicate skipping;
- merge existing entries atomically;
- split an existing entry atomically.

Each command returns structured mutation metadata (`affectedUids`, `createdUids`, `deletedUids`, `structural`, etc.) instead of forcing callers to infer what changed.

### Runtime bridge

`command-runtime.js` is the browser-state bridge:

`Command -> Undo snapshot -> Apply -> Synchronize live entries -> Domain event`

This keeps the pure domain layer testable while preserving the current `state.js` live bindings and autosave behavior.

### Migrated callers

The following paths now use the command runtime instead of directly editing `worldBook.entries`:

- Editor: create / delete / duplicate / field controls / keyword controls;
- Library: batch constant / enable / disable / delete;
- Import: merge into current world book.

High-frequency title/body typing also travels through the same command semantics, but deliberately uses `undo:false` so native textarea undo remains responsible for character-level editing.

### Regression protection

`tests/worldbook-commands.test.mjs` covers UID allocation, no-op detection, batch patching, merge behavior, deletion metadata and split behavior.

`.github/workflows/ci.yml` runs `npm ci` and `npm test` on the refactor branch and pull requests.

## Compatibility invariants

The refactor does **not** change:

- World Book JSON schema;
- entry field names;
- `/api/books` request/response formats;
- auth tokens;
- AI proxy formats;
- localStorage keys;
- SQLite tables/data;
- version/history persistence semantics;
- import/export file format.

## Next engineering gates

### Gate 1 — AI mutations

Move the mutating portions of `chat.js` onto the same command layer. Read-only tools can stay independent. Composite AI actions such as merge/split/replace must remain one atomic undo operation.

The AI turn-level rollback boundary will be separated from individual command snapshots so read-only tool calls do not create fake undo history.

### Gate 2 — AI orchestration split

After mutation parity is verified, split `chat.js` behind stable interfaces:

- stream / SSE transport;
- conversation engine and tool loop;
- world-book tools;
- memory/session persistence;
- message rendering and Markdown;
- smart-draft flow.

### Gate 3 — Application shell

Split `app.js` into boot lifecycle, navigation, settings, API profile/configuration, history and cloud/account features.

### Gate 4 — Server boundaries

Split `server.js` into route/service/repository layers for auth, books, versions, AI proxy/search and cloud storage while keeping existing HTTP contracts unchanged.

## Rule for the remaining refactor

Do not split code merely to reduce file size. A new module must own a coherent responsibility or establish a real boundary. Behavioral parity, data safety and rollback semantics take priority over directory aesthetics.
