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

The current Linux-first desktop MVP includes local Workspaces, BYOK provider routing, Planner and Tutor modes, authoritative workspace context, versioned learning roadmaps, confirmed Planner actions, durable multi-file Python/C/Java projects, Monaco file navigation, sandboxed compilation and execution, adaptive focus sessions, the event-driven Observer, progressive ContextRouter assistance, layered memory, ranked PDF retrieval, priorities, session reports/outline, distraction parking, and backup export/restore.

Runtime requirements for the hardened local tools:

- `python3`, `gcc`, a JDK (`javac`/`java`), `bwrap`, and `prlimit` for sandboxed learning-code execution
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

The local SQLite database is created as `coach.sqlite` under Electron `userData`. Drizzle migrations run automatically during startup. Projects, roadmaps, learning events, materials, planning actions, conversations, memories, and reports remain local unless explicitly sent to the selected AI provider.
