# RFC: Progressive content provisioning

Status: proposed

Owner: COA-172

## Decision

Replace the workspace-wide, in-process provisioning chain with a persistent content-job queue. A workspace becomes `USABLE` only when its accepted roadmap and the first actionable lesson are committed together with readiness evidence. Remaining lessons and exercises are generated progressively according to pedagogical demand; `FULLY_PROVISIONED` means every required unit for the current content revision is valid, not merely that a worker finished.

This RFC defines the contract only. It does not implement it.

## Scope and goals

The contract covers workspace onboarding/provisioning, material extraction and semantic analysis, roadmap generation, study lessons, exercise sets, daily/weekly planning, context assembly, and workspace chat. It must:

- make the first useful study action available without eagerly generating the whole curriculum;
- survive process restart and provider outages without duplicate publication;
- reject stale outputs after roadmap, material, or learning-context revisions;
- keep interactive chat ahead of speculative content work;
- expose timings that separate local/database work, queue wait, provider time, validation, and commit time;
- preserve the current rule that no generic lesson or roadmap may make a workspace appear ready.

Non-goals are changing pedagogy, prompts, provider selection, exercise evaluation, or the visible application design.

## Current pipeline audit

### Workspace creation and provisioning

`WorkspaceService` validates an ephemeral onboarding analysis token/revision, persists the workspace and learning overrides, creates a `workspace_provisioning` row, and starts work asynchronously. `WorkspaceProvisioningService` stores one row per workspace with `draft | queued | running | waiting_for_provider | failed_retryable | ready` and a single stage cursor (`workspace | materials | roadmap | lesson | ready`). Its in-memory `running` map coalesces calls only within one process.

The execution path is serial:

1. snapshot IDs of materials already in `ready`;
2. `RoadmapService.ensureLearningPathWithMaterials`;
3. reload the accepted roadmap;
4. select the first topic of the first module;
5. `StudyLessonService.getOrCreate` for that topic;
6. mark provisioning `ready` when the returned lesson is persisted and specific.

No exercise or plan is part of current readiness. `resumePending` converts interrupted `running` rows to `failed_retryable`, and eligible rows are retried after startup. The row is restartable, but it is not a queue: it has no unit key, priority, lease owner, lease expiry, dependency edge, input revision, output revision, or cancellation generation.

### Heavy generation and content caches

`HeavyGenerationQueue` is a process-local promise tail shared by roadmap, lesson, and exercise services. It has FIFO ordering and a pending counter, but no persistence, priority, cancellation, restart recovery, or interactive bypass. Roadmap and lesson generation can each make one repair provider call after invalid structured output. Exercise generation can also make one repair call and then self-validates executable exercises. Therefore a single logical generation may consume two provider turns.

Roadmaps persist a learning-path lifecycle and recover stale `generating` state. Lessons are unique by `(roadmap_id, topic_id)` and coalesced by an in-memory map. Exercise sets are unique by `(workspace_id, topic_id)`, carry generating/retry states, and are also coalesced only in memory. Exercise identity does not include roadmap revision, so publication must be revision-guarded before reuse can be safe.

### Materials and analysis

`PdfMaterialService.importFile` reads the full PDF/PPTX, computes SHA-256, and reuses an existing material only for the same `(workspace, content_hash)`. A new row is inserted as `staged`; extraction, bounded lexical assessment, optional semantic analysis, optional ambiguous review, chunk replacement, and final status update happen in the same foreground call. Only approved `ready` materials are indexed for retrieval.

`semantic_analysis_json` is stored on the material, but there is no analyzer/prompt/schema version, analysis input hash, or independent analysis revision. The production database inspected for this RFC had eight `ready` materials and zero rows with semantic analysis; this is inventory evidence, not a duration sample. Changing workspace objective/context currently does not provide a hash-based invalidation contract for material analysis or downstream content.

### Planning and pedagogical demand

Daily and weekly planning are deterministic local derivations over accepted roadmap, progress, deadlines, availability, and learning state. Planning does not require provider work. `deriveDailyPlan` ranks incomplete topics, weights difficulty/review needs, and emits study, practice, or review activities within the available budget. Today-plan creation is persisted atomically by the study-workspace repository; weekly replanning has its own revision.

Lessons are generated on first load. Exercise sets are generated just in time on explicit `ensureSet`. There is no durable prefetch signal from the current plan, active topic, lesson progress, checkpoint result, repeated errors, or upcoming deadline.

### Workspace chat and context

`WorkspaceCoachService.streamMessage` performs local work before opening the provider stream: ensure thread/workspace, resolve active exercise, load current workspace context, build immediate context (including current study state, weekly plan revision, and bounded academic-life entries), route depth, and load conversation history. Depending on the routed depth it may then execute up to two provider decision rounds; each can request one bounded context resource read before the final streaming provider request. Thus time to first visible token can contain two complete non-streaming provider round trips plus the final stream TTFT.

The router bounds individual fields and output tokens, and the context hub caps resource reads. However, the initial context is assembled before intent is fully known, and provider-selected deep reads are serial. The global heavy-generation queue does not currently include chat, but heavy background requests compete for provider/network capacity without explicit admission control.

## Measured baseline

### Methodology

Measurements were taken on 2026-09-11 in `/home/gabiru/coach` at commit `d69fc51`, using Node/Vitest and the local SQLite database. No real provider was called and no credentials were accessed.

Two kinds of evidence were collected:

1. Controlled fake-provider unit runs: existing tests use deterministic in-memory providers and exercise generation, validation, repair, caching, coalescing, and streaming code paths. Commands were run separately with `/usr/bin/time`; Vitest's per-test values are useful for regression harness design but are not product latency or provider latency.
2. Read-only SQLite query microbenchmarks: each prepared query received 20 warmups followed by 200 timed executions using `performance.now()`. Results characterize local read cost for the inspected data volume only. The database passed `PRAGMA quick_check` and had zero `foreign_key_check` rows.

No end-to-end workspace provisioning duration, real-model latency, queue-wait distribution, token throughput, or production TTFT is recorded by the current application. Those values are intentionally reported as unavailable rather than inferred.

### Data

| Controlled run | Tests | Vitest test time | Process elapsed | Max RSS |
| --- | ---: | ---: | ---: | ---: |
| workspace provisioning | 3 | 11 ms | 1.14 s | 137,800 KiB |
| roadmap service | 21 | 70 ms | 1.20 s | 139,172 KiB |
| study lesson service | 28 | 32 ms | 1.19 s | 138,500 KiB |
| exercise service | 5 | 19 ms | 2.17 s | 138,028 KiB |
| PDF material service | 12 | 94 ms | 2.17 s | 138,252 KiB |
| planning service | 4 | 19 ms | 2.12 s | 137,632 KiB |
| workspace coach service | 18 | 31 ms | 1.23 s | 140,084 KiB |

The differing process elapsed values include Vitest startup/transform/collection and concurrent host load; they must not be compared as service throughput. A second combined roadmap-plus-lesson run passed 49 tests with 75 ms test time and 481 ms total Vitest duration, demonstrating why test-run wall time is not a stable product baseline.

| Read-only query family | Rows/runs | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| provisioning state | 200 runs | 0.0022 ms | 0.0036 ms | 0.0120 ms |
| accepted roadmap plus modules | 200 runs | 0.0652 ms | 0.1073 ms | 0.2533 ms |
| persisted lessons | 200 runs | 0.3960 ms | 0.5326 ms | 0.6918 ms |
| exercise sets plus exercises | 200 runs | 0.0301 ms | 0.0350 ms | 0.0807 ms |
| weekly plans plus items | 200 runs | 0.0098 ms | 0.0183 ms | 0.2397 ms |

The inspected database contained two active workspaces, three historical provisioning rows marked ready, ten accepted roadmap rows, twenty lessons, twenty-six exercise sets (fifteen ready and eleven failed-retryable), and one weekly plan. Historical rows explain why counts are not one-to-one with active workspaces.

### Required production instrumentation

Every job attempt and chat request must use a monotonic clock for durations and wall-clock UTC for persisted ordering. Emit structured records without prompts, excerpts, message bodies, API keys, or generated content:

- `content_job_wait_ms`, `content_job_provider_ms`, `content_job_validate_ms`, `content_job_commit_ms`, `content_job_total_ms`;
- `content_job_outcome`, `kind`, `priority`, `attempt`, `provider_id`, `model_id`, input/output token counts when supplied;
- `chat_prepare_ms`, `chat_history_ms`, `chat_decision_rounds`, `chat_context_read_ms`, `chat_queue_wait_ms`, `chat_provider_connect_ms`, `chat_ttft_ms`, `chat_stream_ms`, `chat_persist_ms`, `chat_total_ms`;
- counters for cache hit, idempotent coalescing, stale-result rejection, lease recovery, cancellation, repair call, and provider-unavailable transition.

Define `chat_ttft_ms` from IPC handler receipt to the first non-empty `text-delta`. Persist aggregate samples or telemetry events, never sensitive payloads. Before rollout, capture at least 30 controlled fake-provider samples per path with fixed delays and 30 opt-in local real-provider samples per configured provider/model; report p50/p95 and sample count separately.

## Target model

### Workspace state machine

Expose uppercase domain states while retaining lower-case database conventions if desired:

```text
PROVISIONING --readiness transaction--> USABLE --all required units valid--> FULLY_PROVISIONED
      ^                                  |                                  |
      |---- retry/revision/cancel -------+---- new content revision --------+
```

`PROVISIONING` means no current revision satisfies the minimum usable invariant. Provider waiting and retryable failure are conditions, not readiness states. `USABLE` means the learner can execute the first authoritative planned study action. `FULLY_PROVISIONED` means all required content units for the current revision are valid. A new content revision may move `FULLY_PROVISIONED` to `USABLE` if the minimum invariant remains valid, or to `PROVISIONING` if it does not.

Archive is orthogonal. Archiving increments cancellation generation, cancels queued/running jobs, and prevents publication. Unarchive creates a new revision and re-evaluates readiness; it never revives old leases.

### Content revision

Add `workspace_content_revisions`:

```text
workspace_id PK/FK
revision INTEGER NOT NULL CHECK revision > 0
input_hash TEXT NOT NULL
roadmap_id TEXT NULL
first_topic_id TEXT NULL
first_lesson_id TEXT NULL
state TEXT NOT NULL CHECK state IN ('provisioning','usable','fully_provisioned')
cancellation_generation INTEGER NOT NULL DEFAULT 0
created_at, updated_at, usable_at, fully_provisioned_at INTEGER NULL
```

`input_hash` is SHA-256 over canonical JSON with sorted object keys and stable array semantics for: normalized subject/focus/context, declared learning facts, relevant academic constraints, approved material analysis fingerprints, and the roadmap-generator pedagogy/prompt/schema versions. It deliberately excludes the not-yet-generated roadmap to avoid a circular identity. Lesson and exercise job hashes additionally include the accepted roadmap ID plus an immutable `roadmap_content_hash`. Raw material text and secrets are excluded. Any workspace-input change creates revision `n+1`; revisions are immutable identities even if a later hash equals an older hash.

### Persistent content jobs

Add `content_jobs`:

```text
id TEXT PK
workspace_id TEXT NOT NULL FK ON DELETE CASCADE
revision INTEGER NOT NULL
kind TEXT NOT NULL
unit_key TEXT NOT NULL
priority INTEGER NOT NULL
status TEXT NOT NULL
idempotency_key TEXT NOT NULL UNIQUE
input_hash TEXT NOT NULL
dependency_keys_json TEXT NOT NULL DEFAULT '[]'
attempt_count INTEGER NOT NULL DEFAULT 0
max_attempts INTEGER NOT NULL
available_at INTEGER NOT NULL
lease_owner TEXT NULL
lease_token TEXT NULL
lease_expires_at INTEGER NULL
claimed_cancellation_generation INTEGER NULL
started_at, completed_at, cancelled_at INTEGER NULL
last_error_code TEXT NULL
created_at, updated_at INTEGER NOT NULL
UNIQUE(workspace_id, revision, kind, unit_key)
```

Kinds are `MATERIAL_EXTRACT`, `MATERIAL_ANALYZE`, `ROADMAP_GENERATE`, `LESSON_GENERATE`, `EXERCISE_GENERATE`, and `PLAN_RECALCULATE`. Statuses are:

- `BLOCKED`: dependencies are not yet successful;
- `QUEUED`: eligible for claim at `available_at`;
- `LEASED`: exclusively claimed with an unexpired token;
- `SUCCEEDED`: output was transactionally published for the same revision;
- `WAITING_FOR_PROVIDER`: no route is available; reconnect moves it to `QUEUED` without consuming an attempt;
- `FAILED_RETRYABLE`: failed with bounded exponential backoff and jitter;
- `FAILED_TERMINAL`: invalid input or exhausted attempts;
- `CANCELLED`: revision/archive/user cancellation makes the unit ineligible.

Only `QUEUED` and expired `LEASED` jobs can be claimed. Claim is one `BEGIN IMMEDIATE` transaction: select the highest priority eligible row ordered by `priority DESC, available_at ASC, created_at ASC, id ASC`, then conditionally update it to `LEASED`, generate random `lease_token`, increment `attempt_count`, and set expiry. A worker renews before half the lease interval. Provider calls receive an `AbortSignal`; cancellation is cooperative during I/O and authoritative at publication.

Initial constants must be configurable and test-visible: lease 120 seconds, renewal at 60 seconds, maximum three attempts, retry base 30 seconds, retry cap 15 minutes. These are rollout defaults, not measured performance claims.

Priority classes use numeric bands so insertion remains possible:

| Priority | Work |
| ---: | --- |
| 1000 | current user-blocking lesson/exercise |
| 900 | minimum readiness roadmap/first lesson |
| 700 | today's next planned topic |
| 500 | tomorrow/upcoming-deadline prefetch |
| 300 | remaining roadmap lessons |
| 200 | exercise prefetch |
| 100 | maintenance/reanalysis |

Chat never enters this queue. Scheduler admission reserves provider capacity for chat and permits at most one background provider request per configured provider initially. A waiting interactive request prevents the next background lease from starting; an in-flight provider request is not killed unless its job is cancelled.

### Idempotency, revision, restart, and cancellation

`idempotency_key = sha256(workspace_id | revision | kind | unit_key | input_hash | generator_contract_version)`. Enqueue uses `INSERT ... ON CONFLICT DO NOTHING`. In-process maps may reduce work but are never correctness mechanisms.

`generator_contract_version` is a code-owned version for prompt, parser, domain schema, and validation behavior. Every job stores it explicitly in the real schema (the abbreviated table listing above folds it into the idempotency key); implementations must add a non-null `generator_contract_version` column and include it in diagnostic projections. `dependency_keys_json` is validated canonical JSON, but readiness and claim eligibility are established with indexed relational checks against `content_jobs`, never trusted from JSON alone.

Workers build output off-transaction, then publish in `BEGIN IMMEDIATE` with all of these predicates:

1. job is `LEASED` and `lease_token` matches;
2. workspace is active;
3. current `revision` and `input_hash` match the job;
4. current `cancellation_generation` matches the value captured at claim;
5. dependencies are still successful for the same revision;
6. output passes the existing strict domain validator;
7. target uniqueness/revision guard allows insert or replacement.

If any predicate fails, discard the output and mark the job `CANCELLED` with a non-sensitive code; never publish then compensate. Successful publication and `SUCCEEDED` happen in the same transaction. Worker crash leaves a lease to expire. Startup performs no blanket mutation: it atomically requeues only expired leases, then claims normally. Shutdown stops claims, aborts owned signals, and releases owned leases to `QUEUED` when safe; correctness still relies on expiry.

Revision creation cancels all nonterminal older-revision jobs in one transaction. Running requests are aborted after commit. Terminal rows remain for audit and must not be mutated into a newer revision. Manual retry creates or requeues the current revision's job only; terminal attempts are not reset silently.

### Readiness transaction

The transition to `USABLE` is one database transaction and succeeds only if:

- workspace is active and the expected content revision is still current;
- an accepted, strictly valid roadmap belongs to that workspace and revision;
- the roadmap contains at least one active module and one topic;
- `first_topic_id` points to that first actionable topic;
- an AI-generated or explicitly approved subject-specific lesson exists for the same workspace, roadmap, module, topic, and revision;
- the lesson passes current strict lesson validation and contains an actionable required activity/checkpoint;
- today's deterministic study plan contains a non-completed item referencing that topic, or the transaction creates that plan item;
- referenced approved materials, if any, have matching current analysis fingerprints;
- roadmap and first-lesson jobs are `SUCCEEDED` for the revision.

The transaction stores roadmap/topic/lesson IDs, sets `state='usable'`, and timestamps `usable_at`. UI reads readiness from this row; job success alone cannot unlock it. A database constraint cannot express all cross-table predicates, so one repository method owns the transaction and an audit query verifies it.

`FULLY_PROVISIONED` requires `USABLE` plus `SUCCEEDED` and valid published outputs for every required unit in an immutable `content_revision_required_units(revision, kind, unit_key, input_hash)` manifest produced transactionally when the roadmap is accepted. The initial policy puts every active roadmap topic's lesson in the manifest; exercise units enter it only when the accepted roadmap/pedagogy contract marks them required, not merely because prefetch happened. New pedagogical evidence creates a new manifest revision rather than mutating completion criteria underneath workers. Planning jobs must be current but are deterministic and may run synchronously inside readiness. Failed optional enrichment does not block `USABLE`; failed required content blocks `FULLY_PROVISIONED` and is visible per unit.

## Material analysis reuse and invalidation

Split extraction from contextual analysis.

1. Extraction fingerprint: `sha256(file_bytes | extractor_version | chunker_version)`. Extracted pages/chunks may be shared by content hash across workspaces through an immutable blob record; workspace material rows retain ownership and role.
2. Analysis fingerprint: `sha256(extraction_fingerprint | normalized_subject_context | analyzer_contract_version | semantic_schema_version)`. Reuse semantic analysis only when this exact fingerprint matches.
3. Curriculum fingerprint: hash ordered approved material IDs with their analysis fingerprints, role, and relevance. A changed fingerprint creates a new workspace content revision and invalidates roadmap/lesson/exercise jobs whose recorded dependencies differ.

File-byte equality avoids re-extraction. It does not imply contextual-analysis equality across workspaces. Objective/context changes invalidate analysis but retain extracted chunks. Role/relevance-only changes retain extraction and semantic facts but change the curriculum fingerprint. Analyzer/schema upgrades enqueue low-priority reanalysis and do not remove current usable content until replacement publication passes readiness. Deletion/archive cancels dependent jobs; currently published content stays on its old immutable revision until the new revision is usable.

## Pedagogical prefetch

Triggers are durable upserts, not direct provider calls:

- workspace creation: roadmap and first actionable lesson at priority 900;
- readiness: next planned lesson at 700, then its required exercise set at 500;
- plan revision: first not-ready topic today at 700, remaining today at 600, tomorrow at 500;
- learner opens a topic: lesson at 1000; after 50% lesson progress or first checkpoint interaction, exercise at 700 and next lesson at 500;
- topic completion: next incomplete topic lesson at 700 and exercise at 500;
- checkpoint failure, high difficulty, `needsReview`, or repeated execution error: reinforcement lesson/exercise at 700, keyed by learning-state revision;
- deadline enters `near` or `today`: raise affected topic jobs by one band, never duplicate them;
- material/roadmap revision: cancel stale jobs, enqueue only minimum readiness first, then rebuild prefetch from the current plan.

Enqueue is budget-aware: at most two speculative queued units per workspace beyond today's plan and at most one active background provider call per provider. Priority promotion is an atomic `MAX(existing, requested)` update. A user-blocking request may promote an existing job and await its result; it must not create a second generation.

## Chat latency and selective context

### Timeline

Instrument these spans for every workspace turn:

```text
IPC receipt
  -> auth/schema
  -> thread/workspace/history read
  -> cheap intent route
  -> minimal immediate context
  -> optional context decision (0 or 1 provider round)
  -> bounded context reads (parallel when independent)
  -> final provider request
  -> first non-empty delta (TTFT)
  -> remaining stream
  -> atomic turn persistence
  -> completed event
```

The current maximum of two serial decision rounds becomes one. A second deep read requires an explicit user follow-up rather than silently adding another preflight model call. Provider streaming starts with minimal context whenever the answer does not need external material.

### Selective context plan

Phase context by need:

- Always: workspace subject/objective, active page, active study/exercise identifiers, current excerpt bounded to 2,000 characters, timer/plan identifiers, last 12 conversation messages, and compact presentation preferences.
- Active exercise/code help: authoritative public exercise, current code, latest safe diagnostics/output; omit roadmap/material bodies unless requested.
- Lesson explanation: current block plus adjacent block summaries and compact learning state; omit full plan and unrelated academic life.
- Planning/deadline: deterministic planning state and bounded academic events; omit material chunks and source code.
- Material-grounded/deep request: lexical metadata first, then at most three ranked snippets with an aggregate 6,000-character cap.
- General chat: no deep resource read unless the single decision round returns a schema-valid request from an allowlist.

Build cheap intent before `WorkspaceContextHub.immediate`; make immediate-context sections independently loadable. Read independent local sections with `Promise.all`. Cache immutable roadmap/lesson summaries by content revision, never conversation history or active code. Include selected-context byte/character counts in telemetry. Preserve all existing privacy boundaries and public/private exercise separation.

## Migration and rollout

### Database migration

1. Add content revision, jobs, attempt/event telemetry, and revision columns/fingerprint columns to roadmap, lesson, and exercise records. Add indexes for claim ordering, lease recovery, workspace/revision status, and dependency lookup.
2. Backfill one revision per active or historical workspace using only persisted canonical inputs. If required hash inputs are unavailable, mark the revision `provisioning`; do not fabricate a hash component.
3. Backfill `USABLE` only through the readiness audit predicate. Existing `workspace_provisioning.ready` is evidence to inspect, never sufficient by itself.
4. Backfill successful jobs only for outputs that pass current validators and ownership/revision checks. Others receive queued current-revision jobs.
5. Keep `workspace_provisioning` readable during rollout. Dual-write its coarse state from the new projection, but never use it as the authority. Remove it only in a later migration after rollback support expires.

Migration runs in one transaction where SQLite permits, preserves foreign keys, and is covered by fresh/open-existing/reopen tests plus `foreign_key_check` and `quick_check`.

### Feature rollout

1. Instrument current behavior with the new span vocabulary; no scheduler change.
2. Shadow-enqueue jobs while old provisioning remains authoritative; workers do not claim. Compare desired units and readiness audit results.
3. Enable persistent workers for newly created opt-in workspaces, with one worker/provider and no speculative exercise generation.
4. Make new readiness authoritative for opt-in workspaces; keep coarse-state dual write and a kill switch that stops claims without deleting jobs.
5. Enable prefetch by trigger class, monitoring TTFT, stale rejection, provider error rate, queue age, and generated-unit waste.
6. Backfill existing workspaces in bounded batches, then remove old authority in a separate release.

Rollback disables claims and restores reads to the coarse projection. It does not downgrade schema, delete jobs, or reinterpret new revisions. Published content remains readable because publication uses existing domain tables.

## Exact test contract

### State and readiness

1. `PROVISIONING` remains when roadmap succeeds but no valid first lesson exists.
2. A lesson for another workspace, roadmap, topic, or revision cannot satisfy readiness.
3. A provisional/generic/invalid lesson cannot satisfy readiness.
4. `USABLE` publication atomically stores roadmap/topic/lesson IDs and creates or verifies the first plan item.
5. Failure at every statement in the readiness transaction rolls back state and all readiness evidence.
6. `FULLY_PROVISIONED` requires the exact required-unit set for the current revision; optional jobs do not block it.
7. A revision change degrades to `USABLE` only if the minimum invariant remains valid, otherwise to `PROVISIONING`.
8. UI/API projection never maps job success alone to readiness.

### Queue, leases, and idempotency

9. Concurrent enqueue of the same unit yields one row and one idempotency key.
10. Two database connections racing to claim yield distinct jobs; only one owns each lease token.
11. Priority and stable tie ordering match `priority DESC, available_at ASC, created_at ASC, id ASC`.
12. A worker cannot renew, publish, fail, or cancel with another worker's token.
13. An expired lease is reclaimed once; an unexpired lease survives restart untouched.
14. Crash after provider response but before publication causes one eventual publication, not duplicate domain rows.
15. Crash inside publication rolls back both output and `SUCCEEDED`.
16. Provider absence enters `WAITING_FOR_PROVIDER` without incrementing attempts; reconnect requeues once.
17. Retryable failures follow deterministic injected jitter/backoff and become terminal at `max_attempts`.
18. Cancellation aborts the provider signal and stale completion cannot publish.
19. Revision `n` output arriving after revision `n+1` is discarded and counted as stale.
20. Startup, shutdown, archive, unarchive, manual retry, and provider reconnect are idempotent across repeated calls.
21. Foreign key cascade removes jobs on workspace deletion without orphan attempt/event rows.

### Materials and invalidation

22. Same bytes and extractor version reuse extraction without reading/extracting twice.
23. Same bytes with different workspace context reuse extraction but not contextual analysis.
24. Changed extractor/chunker version invalidates extraction and analysis fingerprints.
25. Changed analyzer/schema version invalidates analysis but preserves extracted blobs.
26. Role/relevance change preserves semantic analysis and changes curriculum fingerprint.
27. Material deletion/rejection cancels dependent jobs and cannot expose chunks through retrieval.
28. Reanalysis failure preserves the currently usable immutable revision.

### Prefetch and planning

29. Every trigger upserts/promotes the expected unit and never calls a provider directly.
30. Repeated open/progress/checkpoint events coalesce to one current-revision job.
31. Plan revision recalculates priorities and cancels units no longer required without cancelling user-blocking work.
32. Workspace and provider speculative budgets are enforced under concurrent triggers.
33. Interactive promotion overtakes queued background work but does not duplicate in-flight work.
34. Deterministic plan recalculation produces the same plan for identical revision/timezone inputs.

### Chat latency and context

35. A fake streaming provider with injected connect/first-token/delta delays records each span and TTFT at the first non-empty delta.
36. Fake-provider samples assert measured durations within scheduler-tolerant bounds; they never assert zero or infer real-provider performance.
37. General chat performs zero context-decision calls; a material-grounded request performs at most one.
38. Independent context reads execute in parallel and preserve deterministic prompt ordering.
39. Each intent includes only its allowlisted context; private tests/reference solutions never enter prompts or telemetry.
40. Material snippets are at most three and 6,000 aggregate characters; excerpt/code/output/history bounds remain enforced.
41. Cancellation before first token emits cancellation, persists no partial assistant turn, and releases interactive admission.
42. Background queue saturation does not delay a controlled chat provider start beyond local preparation plus injected fake-provider delay.

### Migration and observability

43. Fresh install, pre-migration fixture, partially provisioned fixture, failed exercise fixture, and reopen all pass schema validation, `quick_check`, and `foreign_key_check`.
44. Backfill never marks ready from legacy coarse state alone and is idempotent on rerun.
45. Kill switch stops new claims, preserves leases/jobs, and leaves published content readable.
46. Telemetry contains IDs/classifications/durations/counts but no prompt, generated text, material excerpt, code, credential, or error body.
47. Histograms report sample count, p50, and p95 independently by provider/model/path; absent samples display unavailable.

## Acceptance and implementation order

Implementation is complete only when all 47 tests exist at the appropriate unit/integration level, controlled fake-provider baselines are checked into test output or an artifact with environment metadata, migration gates pass, and an opt-in workspace can restart during every job phase without violating readiness.

Recommended dependency order is schema/repositories and revision contract, worker/lease runtime, readiness transaction and migration, material fingerprints, pedagogical prefetch, then chat selective-context/instrumentation. Each slice requires a separate critical review before rollout.
