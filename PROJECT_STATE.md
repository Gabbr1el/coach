# PROJECT STATE

## Stack

- Electron 38
- React 19
- TypeScript 5.9 in strict mode
- Vite through electron-vite
- Tailwind CSS 4
- Zustand 5, installed for later UI state
- pnpm
- SQLite through better-sqlite3 13
- Drizzle ORM 0.45 and Drizzle Kit migrations
- electron-builder 26 for packaged runtime validation

## Architecture

- Modular desktop monolith
- Electron Main owns windows, permissions and privileged capabilities
- Preload exposes a narrow typed API through `contextBridge`
- Renderer has no Node integration
- Shared contracts define the Main/renderer boundary
- Application, repository and database layers begin in MVP 0.2/0.3

## Ready

- Official Git repository
- Electron + React + TypeScript bootstrap
- Isolated and sandboxed renderer
- Minimal typed application-info IPC
- Navigation and permission restrictions
- Initial HOME empty state
- Local-only assets and styling
- Typecheck, unit test and production build scripts
- Packaged-bundle smoke test verified with sandboxed preload and typed IPC
- SQLite database created under Electron `userData`
- Drizzle migration history is the single executable migration source
- `workspaces` is the only MVP 0 domain table
- WAL, foreign keys, busy timeout and deterministic close lifecycle
- Linux unpacked package validated with rebuilt native SQLite addon

## Pending

- MVP 0.3: Workspace use cases, repository and IPC
- MVP 0.4: create/list/archive Workspace UI
- MVP 0.5: open Workspace and persist last access
- MVP 1+: AI provider abstraction and BYOK

## Database

- Database file: `coach.sqlite` under Electron `userData`.
- Current migration: `0000_watery_penance.sql`.
- Domain tables: `workspaces` only.
- Infrastructure table: `__drizzle_migrations`.
- Migrations are forward-only and executed transactionally by Drizzle.

## Decisions

- `/home/gabiru/coach` is the official project.
- `/home/gabiru/ed-coach` is a disposable proof of concept and remains untouched.
- C will be the first programming language when the editor arrives.
- No AI, chat, Observer or code execution is included in MVP 0.
- Application identity is frozen as `br.coach.study`, product name `Coach`.
- A single-instance lock prevents concurrent startup migrations.
- Renderer never receives generic IPC, filesystem, database or process APIs.
- CSP uses a development-only localhost/WebSocket allowance that must be tightened for packaged builds.

## Known Issues

- There is no installer or platform packaging configuration yet.
- The HOME action is intentionally disabled until Workspace persistence exists.
- Developer tools remain available in development.
- The earlier GPU/zygote cascade was produced when the smoke-test timeout terminated Electron, not by a startup failure. A direct packaged-bundle smoke test reached the renderer and completed the typed IPC call successfully.
- Hardware acceleration fallback remains available through `COACH_DISABLE_HARDWARE_ACCELERATION=1` for Linux graphics compatibility.

## Next Step

MVP 0.3: add typed Workspace use cases, a repository implementation and narrow validated IPC for creating, listing and opening Workspaces.
