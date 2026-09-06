# Coach Technical Roadmap

## Product invariant

Coach is the study system and owns every durable record. AI providers are replaceable processors. Main process services own privileged operations and context assembly; the renderer only requests user-visible actions.

## Current baseline

- MVP 0: complete (desktop shell, Home, local SQLite, Workspaces).
- MVP 1: complete (provider abstraction, BYOK accounts, durable conversations).
- MVP 2: complete (durable multi-file Python/C/Java projects, Monaco navigation and sandboxed builds).
- MVP 3: complete (persistent study state, adaptive timer, lifecycle and focus events).
- MVP 4: complete (typed event bus, durable events, Observer and repeated-error detection).
- MVP 5: complete (PDF import, extraction, chunks, ranking and automatic retrieval).
- MVP 6: complete (Home Planner, confirmed structured actions, routine, deadlines and priorities).
- MVP 7: complete (session outline, historical navigation and distraction parking).
- MVP 8: complete for the local MVP (pedagogical session insights and layered memory consolidation).

## Delivery sequence

1. Project files and controlled C execution: durable virtual files, Monaco, file navigation, compiler runner with timeout/output limits, structured execution records.
2. Explicit study-session lifecycle and local Observer: start/pause/finish, window blur/focus records, visible Observer status.
3. Learning events and progressive interventions: normalized run/error/plan/focus events, repeated-error detection and intervention offers.
4. Context Router and layered memory: MINIMAL/SESSION/WORKSPACE/DEEP plans, compact memories and progressive-help budgets.
5. Materials: secure PDF import, local extraction/chunks/search and relevant-snippet context.
6. Structured Planner: routine, availability, deadlines, subjects and explainable priority scores.
7. Session history: automatic outline, collapsible navigation and archived session views.
8. Reports and backup: deterministic metrics, optional narrative and versioned atomic export/restore.

## Refactoring controls

- Add one vertical domain slice per migration and commit.
- Keep policy, data and context outside provider adapters.
- Never construct authoritative AI context in the renderer.
- Persist raw events and derive compact views; do not mutate history into summaries.
- Version IPC contracts and backup manifests.
- Gate external sharing by explicit, granular consent.
- Add upgrade tests from the prior released migration for every schema change.

## Deferred by design

- Cloud sync, account and licensing server.
- YouTube integration and semantic embeddings.
- Additional programming languages.
- Local LLM inference.
