# Coach Desktop

Local-first study system focused on understanding how a student reaches an answer.

## Requirements

- Node.js 22.12+
- pnpm 11+

## Development

```bash
pnpm install
pnpm dev
```

## Local MVP

The current Linux-first desktop MVP includes local Workspaces, BYOK provider routing, Planner and Tutor modes, authoritative academic context by subject, versioned learning roadmaps, confirmed Planner and Workspace actions, durable multi-file Python/C/Java projects, Monaco file navigation, sandboxed compilation and execution, adaptive focus sessions, the event-driven Observer, progressive ContextRouter assistance, layered memory, staged PDF/PPTX materials with explicit approval, bounded on-demand context reads, priorities, session reports/outline, distraction parking, and backup export/restore.

Runtime requirements for the hardened local tools:

- `python3`, `gcc`, a JDK (`javac`/`java`), `bwrap`, and `prlimit` for sandboxed learning-code execution
- `pdftotext` (Poppler), `bwrap`, and `prlimit` for sandboxed PDF extraction

Provider API keys remain in Electron `safeStorage` (or session memory when secure persistence is unavailable). Study data stays in `coach.sqlite` under Electron's `userData` directory. The Tutor receives only pertinent, bounded Workspace context and may request approved material pages on demand; it never receives the entire local database. Endpoint retention remains governed by the selected provider. The legacy `shareContextWithAi` field remains stored for compatibility but is not a functional gate.

If Chromium cannot start its GPU process on Linux, use the documented fallback:

```bash
COACH_DISABLE_HARDWARE_ACCELERATION=1 pnpm dev
```

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm package:dir
```

The local SQLite database is created as `coach.sqlite` under Electron `userData`. All 33 forward Drizzle migrations through `0032_workspace_academic_contexts.sql` run automatically during startup, with compatibility repair for preliminary adaptive-study schemas during migration. Projects, roadmaps, learning events, subject declarations, explicit academic relations, staged materials, planning actions, conversations, memories, and reports are stored locally. Student declarations remain separate from observed learning evidence and never become mastery by themselves. Only approved (`ready`) material can be read by the Tutor, in bounded chunks or individual pages/slides.

Known validation gaps are process-level preload/IPC and privacy tests, failure injection across multi-step planning updates, and persisted reopen-and-run journeys for every supported language. Linux is the hardened runtime target; Windows/macOS sandboxing and signed packages remain future work.
