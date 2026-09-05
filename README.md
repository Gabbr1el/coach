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
