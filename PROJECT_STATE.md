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
- Typed Workspace contracts validated at runtime with Zod
- Workspace application service and Drizzle repository
- Narrow IPC for create, list, open and archive operations
- Functional HOME with creation dialog, cards and Workspace opening
- Workspace archive flow and persisted last access
- CoachPolicy v1 and canonical AI provider contracts
- AIProviderManager independent from conversation persistence
- HOME Planner conversation persisted locally
- Planner panel clearly identifies local mode without external AI calls
- BYOK metadata stored separately from credentials
- Electron safeStorage vault with insecure Linux fallback rejected
- OpenAI adapter using the official Responses API
- Provider configuration dialog and explicit connection test
- HOME Planner uses the selected provider while Coach retains the conversation
- Multiple named OpenAI accounts with explicit selection and removal
- Provider switching reconstructs only the selected adapter and retains Coach-owned context
- Database-enforced single active provider account
- Request-scoped Planner streaming over validated IPC
- Cancellation aborts the provider request and discards incomplete turns
- OpenAI Responses API SSE normalized into provider-independent stream events
- Session-only BYOK fallback when the operating-system vault is unavailable
- OpenAI connection diagnostics distinguish credentials, quota, model access and network failures
- OpenAI 429 diagnostics inspect code, type and safe message signals to distinguish billing quota from temporary rate limits
- OpenAI-compatible provider with secure URL validation and Chat Completions streaming
- One-click defaults for a local OmniRoute endpoint
- Workspace chat with isolated local history, workspace-specific context and streamed provider responses
- Persistent study Workspace with guided plan, editor draft, notes, focus timer and AI context

## Pending

- MVP 1.4: structured deadlines, availability and Planner-generated schedule proposals

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
- The HOME owns the PLANNER conversation; Workspaces will own TUTOR conversations.
- Planner currently uses transparent local rules until a provider is explicitly connected.
- API keys are encrypted through Electron safeStorage in restricted local files; SQLite stores only a secret reference.
- Linux `basic_text` safeStorage is rejected instead of silently storing weakly protected credentials.
- Session-only keys are kept in Main process memory, never persisted, and forgotten when Coach closes.
- Provider setup validates API credential and Responses API model compatibility with a minimal generated response; provider usage charges may apply.
- OpenAI is the first provider; no SDK is exposed to renderer or application contracts.
- Compatible endpoints may use plain HTTP only on loopback; remote providers require HTTPS.
- Inactive provider keys remain only in the encrypted vault; adapters retain only the currently active key in memory.
- Application identity is frozen as `br.coach.study`, product name `Coach`.
- A single-instance lock prevents concurrent startup migrations.
- Renderer never receives generic IPC, filesystem, database or process APIs.
- CSP uses a development-only localhost/WebSocket allowance that must be tightened for packaged builds.

## Known Issues

- Workspace IPC and preload behavior have packaged smoke coverage but not direct automated contract tests yet.
- Linux unpacked packaging is configured; signed installers and Windows/macOS targets remain pending.
- Developer tools remain available in development.
- The earlier GPU/zygote cascade was produced when the smoke-test timeout terminated Electron, not by a startup failure. A direct packaged-bundle smoke test reached the renderer and completed the typed IPC call successfully.
- Hardware acceleration fallback remains available through `COACH_DISABLE_HARDWARE_ACCELERATION=1` for Linux graphics compatibility.

## Next Step

MVP 1.4: add structured academic deadlines and weekly availability, then let the HOME Planner propose schedules that require explicit student confirmation.
