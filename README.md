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
```

This is the secure bootstrap for MVP 0. Workspace persistence is intentionally deferred to the next incremental step.
