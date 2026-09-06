# Coach PDF Replica Specification

## Sources

- Visual composition: `Sistema Coach.pdf`
- Product behavior: `Coach_Estudos_IA_Visao_Completa_v2.pdf`

## Global shell

- The application fills the viewport and never scrolls `html`, `body`, or `#root`.
- A dark-green left rail remains visible on desktop and becomes a compact rail on narrow screens.
- The rail exposes Home, Workspaces, History, Reports, and Settings.
- Only content panes scroll. Every grid/flex ancestor of a scroll pane uses `min-height: 0` and `min-width: 0`.
- Cards use warm white surfaces, subtle green borders, rounded corners, yellow accents, and restrained shadows.

## Home

- Greeting and strategic explanation appear at the top.
- The center contains priority cards and today's agenda.
- The right side is a persistent Planner conversation titled "Coach organizando sua semana".
- Planner suggestions remain confirmable actions, not silent mutations.
- Workspace cards show status, progress, focus time, and a direct continue action.

## Workspace

- Header contains workspace identity, observer state, focus timer, and finish-session action.
- Local navigation contains Overview, Plan, Materials, Practice, and Reports.
- The active page changes the center pane without removing the Coach pane.
- Overview summarizes the objective, current module, progress, recent focus, and next action.
- Plan shows today's checklist and the versioned learning roadmap.
- Materials lists ranked PDFs and local search results with page citations.
- Practice contains the durable file tree, tabs, Monaco editor, complete build, and structured diagnostics.
- Reports contains previous sessions, success rate, focus retention, interventions, and recommendation.
- The Coach remains on the right and receives authoritative context for the active page.

## Chat containment

- Conversation panes use `min-width: 0`, `min-height: 0`, and their own vertical overflow.
- Message bubbles use `max-width: 100%`, `min-width: 0`, `overflow-wrap: anywhere`, and `word-break: break-word`.
- Preformatted content and URLs cannot force horizontal overflow.
- Auto-scroll changes only the conversation pane, never the document viewport.

## Functional acceptance

- No global scrollbar at supported desktop dimensions.
- Narrow windows preserve access through compact navigation and internal panes.
- Long unbroken strings, URLs, markdown-like text, and code stay inside chat bubbles.
- All five Workspace pages are functional and preserve state while navigating.
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
