# PROJECT STATE

Execution roadmap: `ROADMAP.md`. The local MVP vertical slices 0-8 are implemented; next work is cross-platform hardening and richer pedagogy.

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
- Versioned SQLite domain schema follows the complete forward-only Drizzle journal
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
- Monaco learning editor and controlled Python execution with timeout, output limits and error signatures
- Visible local Observer with focus events, structured executions and repeated-error loop detection
- ContextRouter with MINIMAL/SESSION/WORKSPACE/DEEP plans and progressive output budgets
- Explicit session completion, durable metrics and automatic fresh-session rollover
- Structured study deadlines, routine notes and explainable multi-factor Workspace priorities
- Local PDF import, page extraction, chunk persistence and scoped material search
- Durable SessionMemory and compact rolling WorkspaceMemory derived from local events
- Collapsible current-session outline and persistent distraction parking list
- Atomic local SQLite backup export after WAL checkpoint
- Validated crash-recoverable backup restoration with migration, schema, FK and integrity checks

## Learning-state authority

| Concern | Authority | Projection | Invalidation / refresh |
| --- | --- | --- | --- |
| Academic schedule | Deadlines, academic events, availability and focus history | HOME schedule and priorities | Recomputed after Planner actions and planning updates |
| Daily plan | Accepted roadmap, study progress and topic learning state | Active session plan items | Recalculated after progress evidence and plan changes |
| Learning path | Accepted roadmap and workspace learning-path state | Trilha and current module/topic | Refreshed when a roadmap is accepted or selection changes |
| Lesson position | Study progress position and checkpoint state | Adaptive Knowledge Page | Persisted on viewport/checkpoint changes |
| Mastery evidence | Topic learning state derived from checkpoints and practice | Reports and adaptive planning | Updated by recorded learning events; no-data remains unevaluated |

## Pending beyond the local MVP

- Cross-platform execution and PDF extraction for Windows/macOS; sandbox tooling is Linux-first
- Full PDF page renderer, FTS/semantic indexing, OCR and material relevance confirmation
- Editable deadlines, explicit weekly availability and generated calendar schedules
- Rich topic extraction, clickable conversation anchors and expanded pedagogical reports
- Optional cloud account, license, sync and focused video integrations

## Database

- Database file: `coach.sqlite` under Electron `userData`.
- Current migration and total are derived from `drizzle/migrations/meta/_journal.json`; no runtime compatibility check duplicates that count.
- Domain tables cover workspaces, conversations, providers, projects, study sessions and plans, academic events, roadmaps, progress, lessons, checkpoints, topic learning evidence, materials, memories, reports, outlines and saved distractions.
- Infrastructure table: `__drizzle_migrations`.
- Migrations are forward-only and executed transactionally by Drizzle.

## Decisions

- `/home/gabiru/coach` is the official project.
- `/home/gabiru/ed-coach` is a disposable proof of concept and remains untouched.
- Python is the first executable learning language; language adapters remain replaceable.
- AI, chat, Observer and code execution are implemented as isolated subsystems.
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
- Planner action effects and progress-to-plan recalculation are durable but not one atomic database transaction; failure-injection coverage remains pending.
- Privacy gates have service-level coverage; a process-level Electron test proving sensitive payload omission remains pending.
- Python, C and Java toolchains have focused tests; persisted reopen-and-run journeys per language remain pending.
- Linux unpacked packaging is configured; signed installers and Windows/macOS targets remain pending.
- Developer tools remain available in development.
- The earlier GPU/zygote cascade was produced when the smoke-test timeout terminated Electron, not by a startup failure. A direct packaged-bundle smoke test reached the renderer and completed the typed IPC call successfully.
- Hardware acceleration fallback remains available through `COACH_DISABLE_HARDWARE_ACCELERATION=1` for Linux graphics compatibility.

## Next Step

Harden process-level IPC/privacy and restart tests, add failure-injection coverage for planning updates, and validate persisted reopen-and-run journeys on all supported toolchains.
