# Coach Technical Roadmap

## Product invariant

Coach is the study system and owns every durable record. AI providers are replaceable processors. Main process services own privileged operations and context assembly; the renderer only requests user-visible actions.

## Current baseline

- MVP 0: complete (desktop shell, Home, local SQLite, Workspaces).
- MVP 1: complete (provider abstraction, BYOK accounts, durable conversations).
- MVP 2: partial (persistent learning editor exists; project files, Monaco, execution and terminal remain).
- MVP 3: partial (persistent study state and focus timer exist; lifecycle and focus events remain).
- MVP 4: not started (structured events, Observer and loop detection).
- MVP 5: not started (PDF import, extraction, chunks and retrieval).
- MVP 6: partial (Home Planner chat exists; structured routine/deadlines/priorities remain).
- MVP 7: not started (session outline and historical navigation).
- MVP 8: not started (pedagogical reports and memory consolidation).

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
