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

The current Linux-first desktop MVP includes local Workspaces, BYOK provider switching, Planner and Tutor modes, Monaco-based Python study execution, active-session focus tracking, the event-driven Observer, progressive ContextRouter assistance, layered memory, PDF import/search, priorities, session history/outline, distraction parking, and backup export/restore.

Runtime requirements for the hardened local tools:

- `python3`, `bwrap`, and `prlimit` for sandboxed learning-code execution
- `pdftotext` (Poppler), `bwrap`, and `prlimit` for sandboxed PDF extraction

Provider API keys remain in Electron `safeStorage` (or session memory when secure persistence is unavailable). Study data stays in `coach.sqlite` under Electron's `userData` directory.

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

The local SQLite database is created as `coach.sqlite` under Electron `userData`. Drizzle migrations run automatically during startup. The current schema contains only the MVP 0 `workspaces` table.
