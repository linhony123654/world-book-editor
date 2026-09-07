# World Book Editor — Lore Atlas V2 Refactor

## Goal

Refactor the interface from a 430px magazine-shaped application into a responsive lore workspace without replacing the proven data model, SQLite persistence, authentication, AI proxy, AI tool loop, import/export or version history.

This branch intentionally separates **presentation refactor risk** from **domain-engine rewrite risk**. Existing DOM IDs and module contracts remain valid while the design system and layout architecture are replaced.

## What changes in this pass

### 1. Design system architecture

`public/style.css` is reduced to an import manifest. Styling is split into:

- `styles/tokens.css` — semantic tokens, type stacks, light/dark palettes, motion constants.
- `styles/base.css` — resets, focus, selection, global material texture and reduced-motion behavior.
- `styles/shell.css` — app shell, masthead, navigation, login surface, toast.
- `styles/library.css` — world overview, search, taxonomy filters, statistics, entry index/grid, batch mode.
- `styles/editor.css` — writing canvas, keywords, inspector, advanced fields, actions.
- `styles/chat.css` — AI document, reasoning, tool trace, change cards, composer.
- `styles/surfaces.css` — archive, settings, profile, dialogs, memory, versions and diff surfaces.
- `styles/responsive.css` — structural breakpoint transformations.

### 2. Desktop workspace

At >=1080px the application no longer renders as a centered phone:

- bottom nav transforms into a persistent left rail;
- Library becomes a two-field workspace: sticky world identity / live entry field;
- Editor becomes writing canvas + sticky property inspector;
- AI chat gets a wide editorial reading measure and floating composer;
- modal sheets become centered dialogs.

### 3. Mobile preservation

Below desktop width:

- the existing bottom-navigation model is preserved;
- dialogs remain bottom sheets;
- editor reverts to a sequential composition;
- entry grids collapse from two columns to one on narrow phones;
- the visual identity (paper, atlas rules, serif + mono hierarchy) remains intact.

### 4. Visual language

The old magazine metaphor is reduced rather than deleted. Useful editorial traits remain — serif type, issue numbering, rules and paper material — while "Lead story"-style framing no longer dictates the whole product. The interface now reads as an archive/editorial instrument.

## Compatibility invariant

This pass does **not** change:

- World Book JSON schema;
- entry field names;
- `/api/books` request/response formats;
- auth tokens;
- AI proxy formats;
- AI tool-loop behavior;
- localStorage keys;
- version/history semantics;
- import/export semantics.

Keeping these invariants is deliberate: the front-end can be visually and compositionally rebuilt without risking user data or AI editing behavior.

## Follow-up engineering phase

After this branch passes visual and regression review, the next architecture pass should split the large orchestration files behind unchanged public interfaces:

1. `chat.js` -> stream parser / conversation engine / tool loop / memory / UI rendering.
2. `app.js` -> shell navigation / settings orchestration / boot lifecycle.
3. `server.js` -> auth / books / versions / AI proxy / cloud routes and services.
4. Introduce a command layer for all entry mutations so human edits, batch edits and AI edits share the same history/validation path.

Do this after the V2 shell is accepted; mixing a complete UI rewrite and a complete domain rewrite in one unreviewed change would make regression diagnosis unnecessarily difficult.
