# PROJECT STATE

## Stack

- Electron 38
- React 19
- TypeScript 5.9 in strict mode
- Vite through electron-vite
- Tailwind CSS 4
- Zustand 5, installed for later UI state
- pnpm
- SQLite and Drizzle: planned for MVP 0.2, not installed yet

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

## Pending

- MVP 0.2: SQLite, Drizzle and first migration
- MVP 0.3: Workspace use cases, repository and IPC
- MVP 0.4: create/list/archive Workspace UI
- MVP 0.5: open Workspace and persist last access
- MVP 1+: AI provider abstraction and BYOK

## Database

- No database exists yet by design.
- MVP 0.2 will introduce only the `workspaces` table.

## Decisions

- `/home/gabiru/coach` is the official project.
- `/home/gabiru/ed-coach` is a disposable proof of concept and remains untouched.
- C will be the first programming language when the editor arrives.
- No AI, chat, Observer or code execution is included in MVP 0.
- Renderer never receives generic IPC, filesystem, database or process APIs.
- CSP uses a development-only localhost/WebSocket allowance that must be tightened for packaged builds.

## Known Issues

- The SQLite native driver must be validated against packaged Electron before product features expand.
- There is no installer or platform packaging configuration yet.
- The HOME action is intentionally disabled until Workspace persistence exists.
- Developer tools remain available in development.
- The earlier GPU/zygote cascade was produced when the smoke-test timeout terminated Electron, not by a startup failure. A direct packaged-bundle smoke test reached the renderer and completed the typed IPC call successfully.
- Hardware acceleration fallback remains available through `COACH_DISABLE_HARDWARE_ACCELERATION=1` for Linux graphics compatibility.

## Next Step

MVP 0.2: add SQLite and Drizzle, create the first migration, store the database under Electron `userData`, and prove persistence across application restarts.
