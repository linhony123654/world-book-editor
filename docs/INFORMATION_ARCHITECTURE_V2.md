# Lore Atlas V2 — Information Architecture

The current runtime routes/screens are retained for compatibility, but their conceptual roles are normalized:

| Existing screen | V2 role | Primary task |
| --- | --- | --- |
| Library | World Index | Search, browse, classify, enter an entry |
| Editor | Editorial Desk | Write and configure one lore entry |
| AI Chat | AI Editor | Instruct, inspect reasoning/tool activity, review changes |
| Archives | World Books | Switch/create/delete world books |
| Settings / Me | Workspace controls | API, storage, history, theme, account |

## Interaction priority

1. Current world and active entry.
2. Search/filter and entry navigation.
3. Writing and trigger/injection configuration.
4. AI-assisted modification and change inspection.
5. Archives, versions, storage and account operations.

## Desktop spatial model

- Left rail: stable global navigation.
- Library: world identity on the left; live entry field on the right.
- Editor: content field on the left; inspector on the right.
- AI: long-form editorial working document with anchored composer.

## Mobile spatial model

- Bottom navigation remains the global entry mechanism.
- The current screen owns the viewport.
- Inspector content follows the writing canvas instead of competing side-by-side.
- Dialogs use bottom-sheet behavior.
