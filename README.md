# FORMA — Train. Track. Progress.

A static, installable, **account-free** fitness tracker with independent local workspaces. No backend, login, analytics or network calls for workout tracking.

## Features
- Multiple workspaces per installation (name, avatar, colour), quick switcher in the header, edit/rename, export, delete (with "export first" option), per-workspace workout counts.
- Confirmation before switching away from a workout in progress.
- Onboarding on first launch; the last active workspace is restored automatically afterwards.
- Existing single-user installs are migrated into a workspace named **My Training** (originals are kept).
- Versioned JSON backups: single workspace, or all workspaces. Import validates structure/version/data and asks what to do on an ID conflict. Older FORMA backups still import.
- Automatic safety snapshots (last 3 per workspace) before every restore, with a "Restore points" list and automatic rollback if a restore fails.
- Installable PWA with offline app shell.

## Architecture & storage
`index.html` holds the app. The first `<script>` is the **workspace layer**: it wraps `localStorage` so the existing synchronous workout engine transparently reads/writes keys namespaced as `forma.workspace.data.<workspaceId>.<key>`. The registry is `forma.workspaces.v1`; the active pointer is `forma.workspace.active`; snapshots are `forma.workspace.snap.<id>.<timestamp>`. Isolation is enforced in the storage layer, not just the UI. Every workspace change is mirrored (debounced) to IndexedDB (`forma-local-v1`); if localStorage is wiped but IndexedDB survives, workspaces are restored on next launch.

**Current limitation:** localStorage is still the primary store (the workout engine is synchronous); IndexedDB is a full recovery mirror, not yet the primary store. Moving to IndexedDB-primary would require making the engine asynchronous.

## Backups
Workspace backup: `forma-<name>-<date>.json` (`format: forma.workspace`, `version: 2`, includes workspace id/name/avatar/colour, export date and all workspace data). Full backup: `format: forma.all` with every workspace and the active ID. Export uses the Web Share API with files where supported, otherwise a download. Import uses a normal file picker. Workspaces are local profiles, **not** encrypted or password-protected.

## Develop, test, deploy
- Local: `python3 -m http.server 8080` (service worker needs `localhost` or HTTPS).
- Tests: `node tests/workspace-tests.js` — data-layer behaviour in a Node `vm` with a fake localStorage, plus static UI/PWA checks. It does not run a browser, IndexedDB, a service worker or any device.
- Deploy: upload the folder to any static HTTPS host. Bump `CACHE` in `sw.js` when shell files change; updates never touch user data.
