import { describe, expect, it, vi } from 'vitest'
import { HomeOrganizerService } from '../../src/application/conversations/home-organizer-service'
import type { OrganizerIntentInterpreter } from '../../src/application/conversations/organizer-intent-interpreter'
import { LocalOrganizerIntentInterpreter, ProviderOrganizerIntentInterpreter } from '../../src/application/conversations/organizer-intent-interpreter'
import { emptyOrganizerConversationState } from '../../src/shared/contracts/organizer-conversation-state-contract'

const emptyMutation = { changed: false, summary: '', workspaceIds: [], needsRefinement: null }
const blankEntities = { subject: null, query: null, dateExpression: null, dateFromExpression: null, dateToExpression: null, eventKind: null, weekday: null, minutes: null, completed: null, target: null, status: null }

function setup(options: { workspaces?: Array<{ id: string; name: string }>; listWorkspaces?: () => Promise<Array<{ id: string; name: string }>>; pending?: any[]; academicLife?: any[]; planItems?: any[]; deadlines?: any[]; availability?: any[]; reviewNeeds?: any[]; interpreter?: OrganizerIntentInterpreter; state?: any; currentTime?: number; currentDate?: string; timezone?: string; failCommitAt?: 'ensureHomeThread' | 'state' | 'action' | 'turn'; beforeCommit?: () => void } = {}) {
  const turns: Array<{ content: string; message: string; id?: string }> = []; const proposed: any[] = []; const proposedByScope = new Map<string, any>(); let authority: any = null; let planningWrites = 0; let contextWrites = 0
  let state = options.state ?? emptyOrganizerConversationState(); let stateWrites = 0; let id = 0
  const conversation: any = {
    threadId: '00000000-0000-4000-8000-000000000000', createMessageId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`, listRecentUserMessages: async () => turns.slice(-4).map((turn) => ({ content: turn.content, createdAt: 1 })),
    listMessages: async () => [],
    saveAuthoritativeTurn: async (content: string, message: string, id?: string) => { turns.push({ content, message, id }); return [{ id: id ?? 'assistant', role: 'assistant', content: message, createdAt: 1, sequence: 1, providerId: null, modelId: null }] },
    createAuthoritativeTurn: (content: string, message: string, id?: string, userId?: string, providerId = 'coach-local', modelId = 'home-organizer-v1') => ({ threadId: '00000000-0000-4000-8000-000000000000', now: 1, user: { id: userId ?? 'user', threadId: '00000000-0000-4000-8000-000000000000', role: 'user', content, createdAt: 1, providerId: null, modelId: null }, assistant: { id: id ?? 'assistant', threadId: '00000000-0000-4000-8000-000000000000', role: 'assistant', content: message, createdAt: 2, providerId, modelId } }),
    generateMessageWithAuthority: async (_input: unknown, context: unknown) => { authority = context; return { content: 'Estou bem e pronto para ajudar.', providerId: 'test', modelId: 'test' } },
    sendMessageWithAuthority: async (_input: unknown, context: unknown) => { authority = context; return [{ id: 'assistant', role: 'assistant', content: 'Estou bem e pronto para ajudar.', createdAt: 1, sequence: 1, providerId: null, modelId: null }] },
  }
  const plan = { id: 'week', weekStart: '2026-09-07', timezone: 'UTC', revision: 1, generatedAt: 1, days: [{ dateKey: '2026-09-07', weekday: 1, availableMinutes: 120, scheduledMinutes: 0, status: 'today', items: options.planItems ?? [] }] }
  const planning: any = { applyAcademicMessage: () => { planningWrites += 1; return emptyMutation }, getAcademicOverview: () => ({ events: options.deadlines ?? [], availability: options.availability ?? [], workspaces: [], routine: [] }), listReviewNeeds: () => options.reviewNeeds ?? [], getWeeklyPlan: () => { planningWrites += 1; return plan }, peekWeeklyPlan: () => plan }
  const stage = (input: any) => ({ action: { id: crypto.randomUUID(), status: 'proposed', result: null, createdAt: 1, resolvedAt: null, ...input }, idempotencyKey: input.idempotencyScope ?? crypto.randomUUID() })
  const actions: any = { listPending: () => options.pending ?? [], stageProposal: stage, propose: (input: any) => { const staged = stage(input); if (input.idempotencyScope && proposedByScope.has(input.idempotencyScope)) return proposedByScope.get(input.idempotencyScope); proposed.push(staged.action); if (input.idempotencyScope) proposedByScope.set(input.idempotencyScope, staged.action); return staged.action } }
  const states: any = { load: () => state, save: (_threadId: string, next: any) => { stateWrites += 1; state = next; return next }, clear: () => { state = emptyOrganizerConversationState() } }
  const committedRequests = new Map<string, any>()
  const unitOfWork: any = { find: async (requestId: string, _threadId: string, content: string) => { const committed = committedRequests.get(requestId); if (committed && committed.content !== content) throw new Error('Organizer requestId was reused with different input'); return committed?.value ?? null }, commit: async (input: any, signal?: AbortSignal) => { const replay = committedRequests.get(input.requestId); if (replay) return replay.value; options.beforeCommit?.(); signal?.throwIfAborted(); for (const boundary of ['ensureHomeThread', 'state', 'action', 'turn'] as const) if (options.failCommitAt === boundary) throw new Error(`injected ${boundary}`); if (input.state) { stateWrites += 1; state = input.state } const committed = input.actions.map(({ action, idempotencyKey }: any) => { const existing = proposedByScope.get(idempotencyKey); if (existing) return existing; proposed.push(action); proposedByScope.set(idempotencyKey, action); return action }); turns.push({ content: input.turn.user.content, message: input.turn.assistant.content, id: input.turn.assistant.id }); const result = input.actions.length ? { ...input.result, actions: committed } : input.result; const value = { messages: [input.turn.user, input.turn.assistant], actions: committed, result }; committedRequests.set(input.requestId, { content: input.turn.user.content, value }); return value } }
  const currentTime = options.currentTime ?? Date.UTC(2026, 8, 7, 12); const service = new HomeOrganizerService(conversation, planning, actions, options.listWorkspaces ?? (async () => options.workspaces ?? []), () => currentTime, () => (options.academicLife ?? []).map((item) => ({ shareWithAi: true, ...item })), options.interpreter, () => ({ currentTime, currentDate: options.currentDate ?? '2026-09-07', timezone: options.timezone ?? 'UTC' }), states, unitOfWork)
  return { service, proposed, turns, authority: () => authority, planningWrites: () => planningWrites, contextWrites: () => contextWrites, stateWrites: () => stateWrites, state: () => state }
}

describe('HomeOrganizerService', () => {
  it.each(['ensureHomeThread', 'state', 'action', 'turn'] as const)('commits no organizer writes when the %s boundary fails', async (failCommitAt) => {
    const initialState = { ...emptyOrganizerConversationState(), pendingWorkspacePreparation: { subject: 'POO', originalMessageId: 'origin', originalCreatedAt: 1 }, updatedAt: 1 }
    const ctx = setup({ state: initialState, failCommitAt })

    await expect(ctx.service.organize({ content: 'quero criar' })).rejects.toThrow(`injected ${failCommitAt}`)

    expect(ctx.turns).toHaveLength(0)
    expect(ctx.proposed).toHaveLength(0)
    expect(ctx.state()).toEqual(initialState)
    expect(ctx.stateWrites()).toBe(0)
  })
  it('checks cancellation immediately before the atomic commit', async () => {
    const controller = new AbortController()
    const ctx = setup({ beforeCommit: () => controller.abort() })

    await expect(ctx.service.organize({ content: 'Hoje tenho 4 horas para estudar' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })

    expect(ctx.turns).toHaveLength(0)
    expect(ctx.proposed).toHaveLength(0)
    expect(ctx.stateWrites()).toBe(0)
  })
  it('propagates cancellation to the provider and persists no turn after cancel', async () => {
    const controller = new AbortController()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const interpreter: OrganizerIntentInterpreter = { interpret: async (_content, _context, signal) => new Promise((_resolve, reject) => { markStarted(); signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }) }) }
    const ctx = setup({ interpreter })
    const pending = ctx.service.organize({ content: 'organize isto' }, controller.signal)
    await started
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(ctx.turns).toHaveLength(0)
    expect(ctx.proposed).toHaveLength(0)
    expect(ctx.stateWrites()).toBe(0)
  })
  it('checks cancellation immediately after listing workspaces', async () => {
    const controller = new AbortController()
    let resolveWorkspaces!: (workspaces: Array<{ id: string; name: string }>) => void
    const ctx = setup({ listWorkspaces: () => new Promise((resolve) => { resolveWorkspaces = resolve }) })
    const pending = ctx.service.organize({ content: 'me explica ponteiros' }, controller.signal)
    await vi.waitFor(() => expect(resolveWorkspaces).toBeTypeOf('function'))
    controller.abort()
    resolveWorkspaces([])
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(ctx.turns).toHaveLength(0)
    expect(ctx.stateWrites()).toBe(0)
  })
  it('does not propose a workspace action when cancelled during workspace listing', async () => {
    const controller = new AbortController()
    let resolveWorkspaces!: (workspaces: Array<{ id: string; name: string }>) => void
    const state = { ...emptyOrganizerConversationState(), pendingWorkspacePreparation: { subject: 'POO', originalMessageId: 'origin', originalCreatedAt: 1 }, updatedAt: 1 }
    const ctx = setup({ state, listWorkspaces: () => new Promise((resolve) => { resolveWorkspaces = resolve }) })
    const pending = ctx.service.organize({ content: 'quero criar' }, controller.signal)
    await vi.waitFor(() => expect(resolveWorkspaces).toBeTypeOf('function'))
    controller.abort()
    resolveWorkspaces([])
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(ctx.proposed).toHaveLength(0)
    expect(ctx.stateWrites()).toBe(0)
  })
  it('preserves the previous workspace preparation when cancelled after staging a replacement', async () => {
    const controller = new AbortController()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const previousPreparation = { subject: 'Rust', originalMessageId: 'previous', originalCreatedAt: 1 }
    const interpreter: OrganizerIntentInterpreter = { interpret: async (_content, _context, signal) => new Promise((_resolve, reject) => { markStarted(); signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }) }) }
    const ctx = setup({ interpreter, state: { ...emptyOrganizerConversationState(), pendingWorkspacePreparation: previousPreparation, updatedAt: 1 } })

    const pending = ctx.service.organize({ content: 'tenho prova de POO e quero aprender javascript' }, controller.signal)
    await started
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(ctx.state().pendingWorkspacePreparation).toEqual(previousPreparation)
    expect(ctx.stateWrites()).toBe(0)
    expect(ctx.turns).toHaveLength(0)
  })
  it('preserves pending intents when cancelled during the second interpretation', async () => {
    const controller = new AbortController()
    let markSecondStarted!: () => void
    const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve })
    let calls = 0
    const previousPreparation = { subject: 'Rust', originalMessageId: 'workspace-origin', originalCreatedAt: 1 }
    const previousPending = { capability: 'academic.event.create' as const, entities: { ...blankEntities, subject: 'POO', eventKind: 'exam' as const }, missingFields: ['dateExpression'], originalMessageId: 'exam-origin', originalText: 'tenho prova de POO', originalCreatedAt: 1, originalCurrentDate: '2026-09-07', originalTimezone: 'UTC' }
    const interpreter: OrganizerIntentInterpreter = {
      interpret: async (_content, _context, signal) => {
        calls += 1
        if (calls === 1) return { mode: 'conversation', capability: null, entities: blankEntities, confidence: 1, missingFields: [], summary: 'new request' }
        return new Promise((_resolve, reject) => { markSecondStarted(); signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }) })
      },
    }
    const initialState = { ...emptyOrganizerConversationState(), pending: previousPending, pendingWorkspacePreparation: previousPreparation, updatedAt: 1 }
    const ctx = setup({ interpreter, state: initialState, currentTime: 2 })

    const pending = ctx.service.organize({ content: 'organize uma nova coisa' }, controller.signal)
    await secondStarted
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(ctx.state()).toEqual(initialState)
    expect(ctx.stateWrites()).toBe(0)
    expect(ctx.turns).toHaveLength(0)
  })
  it('excludes a private academic title from provider prompt and focus while retaining public focus', async () => {
    const privateId = crypto.randomUUID(); const publicId = crypto.randomUUID(); const prompts: string[] = []
    const academic = (id: string, subject: string, shareWithAi: boolean) => ({ id, kind: 'event', status: 'active', title: `Prova ${subject}`, details: JSON.stringify({ schema: 'academic-event/v1', eventKind: 'exam', subject, sourceText: subject }), workspaceId: null, startsAt: null, endsAt: Date.UTC(2026, 8, 20), expiresAt: null, timezone: 'UTC', weekday: null, minutes: null, shareWithAi, provenance: { source: 'user_ui', reference: null }, replacesId: null, replacedById: null, createdAt: 1, updatedAt: 1, resolvedAt: null, archivedAt: null })
    const provider = { sendMessage: async (request: { messages: Array<{ content: string }> }) => { prompts.push(JSON.stringify(request.messages)); return { content: JSON.stringify({ mode: 'conversation', capability: null, entities: blankEntities, confidence: 1, missingFields: [], summary: 'ok' }), providerId: 'test', modelId: 'test' } } }
    const baseState = { ...emptyOrganizerConversationState(), focusedSubject: 'SEGREDO PRIVADO', focusedAcademicEventId: privateId, updatedAt: 1 }
    const privateContext = setup({ academicLife: [academic(privateId, 'SEGREDO PRIVADO', false), academic(publicId, 'PÚBLICO', true)], state: baseState, interpreter: new ProviderOrganizerIntentInterpreter({ route: () => provider } as any) })
    await privateContext.service.organize({ content: 'olá' })
    expect(prompts.at(-1)).not.toContain('SEGREDO PRIVADO'); expect(privateContext.state().focusedAcademicEventId).toBeNull(); expect(privateContext.state().focusedSubject).toBeNull()
    const publicContext = setup({ academicLife: [academic(publicId, 'PÚBLICO', true)], state: { ...baseState, focusedSubject: 'PÚBLICO', focusedAcademicEventId: publicId }, interpreter: new ProviderOrganizerIntentInterpreter({ route: () => provider } as any) })
    await publicContext.service.organize({ content: 'olá' })
    expect(prompts.at(-1)).toContain('PÚBLICO'); expect(publicContext.state().focusedAcademicEventId).toBe(publicId)
  })
  it('keeps exact pedagogical routing in Workspace/Tutor behavior', async () => { const ctx = setup({ workspaces: [{ id: 'c', name: 'C' }] }); const turn = await ctx.service.organize({ content: 'me explica ponteiros em C' }); expect(turn.result).toMatchObject({ outcome: 'needs_decision', affectedWorkspaceIds: ['c'] }); expect(ctx.proposed).toHaveLength(0) })
  it('routes explicit learning intent to the requested Workspace instead of tutoring in HOME', async () => {
    const ctx =
      setup({
        workspaces: [
          {
            id:
              'poo',

            name:
              'POO',
          },
          {
            id:
              'java',

            name:
              'Java',
          },
        ],
      })

    const turn =
      await ctx.service.organize({
        content:
          'eu vou ter prova de POO, e quero aprender java',
      })

    expect(
      turn.result,
    ).toMatchObject({
      outcome:
        'needs_information',

      affectedWorkspaceIds:
        ['java'],
    })

    expect(
      turn.result.message,
    ).toContain(
      'Workspace de Java',
    )

    expect(
      turn.result.message,
    ).not.toMatch(
      /classes|herança|polimorfismo|encapsulamento/i,
    )

    expect(
      ctx.proposed,
    ).toHaveLength(0)
  })

  it('does not confuse a study-duration planning request with a pedagogical request', async () => {
    const ctx =
      setup()

    const turn =
      await ctx.service.organize({
        content:
          'quero estudar 2 horas hoje',
      })

    expect(
      turn.result.actions[0],
    ).toMatchObject({
      type:
        'plan.today-budget.set',

      payload: {
        minutes:
          120,
      },
    })
  })

  it('preserves an exam while routing a learning request from the same message', async () => {
    const ctx = setup({ workspaces: [{ id: 'c', name: 'C' }] })
    const turn = await ctx.service.organize({
      content: 'eu vou ter prova de python de dados, e quero aprender c',
    })

    expect(turn.result.message).toContain('Workspace de C')
    expect(ctx.state().pending).toMatchObject({
      capability: 'academic.event.create',
      entities: { subject: 'python de dados', eventKind: 'exam' },
      missingFields: ['dateExpression'],
    })
  })

  it('keeps a dated exam independent from Workspace while routing another learning subject', async () => {
    const ctx = setup()
    const turn = await ctx.service.organize({
      content: 'tenho prova de Python dia 25 às 19h, e quero aprender JavaScript',
    })

    expect(turn.result.actions[0]).toMatchObject({
      type: 'academic-life.save',
      payload: { workspaceId: null },
    })
    expect(turn.result.message).toContain('Workspace de JavaScript')
  })

  it('keeps small talk informational without proposing a write', async () => { const ctx = setup(); const turn = await ctx.service.organize({ content: 'como voce está?' }); expect(turn.result.outcome).toBe('informational'); expect(ctx.proposed).toHaveLength(0); expect(ctx.authority()).toMatchObject({ currentDate: '2026-09-07', operationResult: null }) })
  it.each(['quais provas eu tenho?', 'quando é meu próximo prazo?', 'mostre meus trabalhos'])('treats read phrase %s as a query with zero domain writes', async (content) => { const ctx = setup(); const turn = await ctx.service.organize({ content }); expect(turn.result.outcome).toBe('informational'); expect(ctx.proposed).toHaveLength(0); expect(ctx.planningWrites()).toBe(0); expect(ctx.contextWrites()).toBe(0) })
  it('does not classify cancellation as create', async () => { const ctx = setup(); const turn = await ctx.service.organize({ content: 'cancele a prova de C' }); expect(turn.result.outcome).toBe('needs_information'); expect(ctx.proposed).toHaveLength(0) })
  it('invalid provider output produces zero domain writes', async () => { const provider = { sendMessage: async () => ({ content: '{not-json', providerId: 'test', modelId: 'test' }) }; const ctx = setup({ interpreter: new ProviderOrganizerIntentInterpreter({ route: () => provider } as any) }); const turn = await ctx.service.organize({ content: 'qual é meu prazo?' }); expect(turn.result.outcome).toBe('failed'); expect(ctx.turns).toHaveLength(0); expect(ctx.proposed).toHaveLength(0); expect(ctx.planningWrites()).toBe(0); expect(ctx.contextWrites()).toBe(0) })
  it.each([
    ['Quais matérias estão com prazo mais próximo?', 'query'],
    ['qual é a prova de C no dia 16?', 'query'],
    ['A prova foi cancelada', 'cancellation'],
    ['cancele a prova de C no dia 16', 'cancellation'],
  ])('rejects malicious provider create classification for %s', async (content, expected) => {
    const provider = { sendMessage: async () => ({ content: JSON.stringify({ mode: 'mutation', capability: 'academic-life.save', entities: { ...blankEntities, subject: content.includes(' C ') ? 'C' : 'POO', dateExpression: 'dia 16' }, confidence: 0.99, missingFields: [], summary: 'Crie imediatamente' }), providerId: 'test', modelId: 'test' }) }
    const ctx = setup({ workspaces: [{ id: '00000000-0000-4000-8000-000000000011', name: 'C' }, { id: '00000000-0000-4000-8000-000000000012', name: 'POO' }], interpreter: new ProviderOrganizerIntentInterpreter({ route: () => provider } as any) })
    const turn = await ctx.service.organize({ content })
    expect(turn.result.outcome).toBe(expected === 'query' ? 'informational' : 'needs_information')
    expect(turn.result.message).toMatch(expected === 'query' ? /consulta|nenhuma alteração/i : /cancelamento|nenhuma criação/i)
    expect(ctx.proposed).toHaveLength(0)
    expect(ctx.planningWrites()).toBe(0)
    expect(ctx.contextWrites()).toBe(0)
  })
  it('preserves a legitimate declarative exam mutation without a Workspace', async () => { const provider = { sendMessage: async () => ({ content: JSON.stringify({ mode: 'mutation', capability: 'academic.event.create', entities: { ...blankEntities, subject: 'POO', eventKind: 'exam', dateExpression: 'dia 14' }, confidence: 0.95, missingFields: [], summary: 'Registrar prova' }), providerId: 'test', modelId: 'test' }) }; const ctx = setup({ interpreter: new ProviderOrganizerIntentInterpreter({ route: () => provider } as any) }); const turn = await ctx.service.organize({ content: 'Tenho prova de POO dia 14' }); expect(turn.result).toMatchObject({ outcome: 'needs_decision', actions: [expect.objectContaining({ type: 'academic-life.save', payload: expect.objectContaining({ workspaceId: null, title: 'Prova POO', shareWithAi: false }) })] }); expect(ctx.planningWrites()).toBe(0) })
  it('intercepts a complete academic event before the configured provider can fail', async () => { const sendMessage = vi.fn(async () => { throw new Error('provider offline') }); const ctx = setup({ interpreter: new ProviderOrganizerIntentInterpreter({ route: () => ({ sendMessage }) } as any) }); const first = await ctx.service.organize({ content: 'Tenho prova de POO hoje as 5 da tarde' }); expect(sendMessage).not.toHaveBeenCalled(); expect(first.result).toMatchObject({ outcome: 'needs_decision', actions: [expect.objectContaining({ type: 'academic-life.save', payload: expect.objectContaining({ title: 'Prova POO' }) })] }); expect(first.result.actions[0]!.id).toBeTruthy() })
  it('creates an academic event proposal instead of preparing a hidden Workspace', async () => { const ctx = setup(); const turn = await ctx.service.organize({ content: 'tenho prova de C no dia 16' }); const action = turn.result.actions[0]; expect(action).toMatchObject({ type: 'academic-life.save', payload: { workspaceId: null, title: 'Prova C' }, originMessageId: '00000000-0000-4000-8000-000000000001' }) })
  it('proposes a typed today budget but performs no direct write', async () => { const ctx = setup(); const turn = await ctx.service.organize({ content: 'Hoje tenho 4 horas para estudar' }); expect(turn.result).toMatchObject({ outcome: 'needs_decision', actions: [expect.objectContaining({ type: 'plan.today-budget.set', payload: expect.objectContaining({ minutes: 240, dateKey: '2026-09-07' }) })] }); expect(ctx.proposed).toHaveLength(1) })
  it('keeps composite budget and replan behind one atomic confirmed action', async () => { const ctx = setup(); const turn = await ctx.service.organize({ content: '30 min hoje. Reorganize' }); expect(turn.result.actions).toEqual([expect.objectContaining({ type: 'plan.today-budget.set', payload: expect.objectContaining({ minutes: 30 }), label: expect.stringMatching(/atomicamente/) })]); expect(ctx.planningWrites()).toBe(0) })
  it('reads all planning projections without writes and sorts nearest academic dates', async () => { const later = academicEvent({ id: '00000000-0000-4000-8000-000000000031', title: 'Trabalho Java', endsAt: Date.UTC(2026, 8, 20, 23, 59), expiresAt: Date.UTC(2026, 8, 20, 23, 59), details: eventMetadata('assignment', 'Java') }); const soon = { id: 'deadline', workspaceId: 'c', workspaceName: 'C', type: 'deadline', title: 'Prazo C', dueAt: Date.UTC(2026, 8, 10, 23, 59), phase: 'near' }; const ctx = setup({ academicLife: [later], deadlines: [soon], availability: [{ weekday: 5, minutes: 60 }] }); const nearest = await ctx.service.organize({ content: 'Quais matérias estão com prazo mais próximo?' }); expect(nearest.result.message.indexOf('Prazo C')).toBeLessThan(nearest.result.message.indexOf('Trabalho Java')); expect((await ctx.service.organize({ content: 'Qual minha disponibilidade?' })).result.message).toContain('sexta: 60 min'); expect((await ctx.service.organize({ content: 'Qual meu plano hoje?' })).result.outcome).toBe('informational'); expect((await ctx.service.organize({ content: 'Qual meu plano da semana?' })).result.outcome).toBe('informational'); expect(ctx.planningWrites()).toBe(0); expect(ctx.stateWrites()).toBe(0); expect(ctx.proposed).toHaveLength(0) })
  it('writes conversation state only when revalidation removes stale authority', async () => { const stale = crypto.randomUUID(); const initial = { ...emptyOrganizerConversationState(7), focusedAcademicEventId: stale, recentResolvedAcademicEventIds: [stale] }; const ctx = setup({ state: initial, currentTime: 10 }); await ctx.service.organize({ content: 'Qual meu plano hoje?' }); expect(ctx.stateWrites()).toBe(1); expect(ctx.state()).toMatchObject({ focusedAcademicEventId: null, recentResolvedAcademicEventIds: [], updatedAt: 10 }) })
  it('ranks today plan, deadlines and due fragile review explainably without mutation', async () => { const ctx = setup({ planItems: [{ id: crypto.randomUUID(), workspaceId: 'c', workspaceName: 'C', title: 'Ponteiros', status: 'pending', position: 1, durationMinutes: 30, reason: 'continuidade', dateKey: '2026-09-07' }], reviewNeeds: [{ workspaceId: 'poo', workspaceName: 'POO', conceptId: 'encapsulation', conceptName: 'Encapsulamento', nextReviewAt: 1, retention: 'fragile', performance: 'struggling', dueAt: null }] }); const turn = await ctx.service.organize({ content: 'Qual é a coisa mais importante hoje?' }); expect(turn.result.message).toMatch(/Encapsulamento.*revisão está vencida/i); expect(turn.result.message).toContain('nada foi alterado'); expect(ctx.planningWrites()).toBe(0); expect(ctx.proposed).toHaveLength(0) })
  it('supports Friday 60 minutes but reports exact schema gaps without fake actions', async () => { const friday = setup(); expect((await friday.service.organize({ content: 'Sextas só 1h' })).result.actions[0]).toMatchObject({ type: 'plan.weekday-availability.set', payload: { weekday: 5, minutes: 60 } }); for (const text of ['Reserve 1h para revisão', 'Mova o item de C', 'Quartas trabalho até 18h', 'Estou de férias até dia 20']) { const ctx = setup(); const turn = await ctx.service.organize({ content: text }); expect(turn.result).toMatchObject({ outcome: 'informational', actions: [] }); expect(ctx.proposed).toHaveLength(0) } })
  it('keeps an unlinked 5h event out of replan until its confirmed link', async () => { const ctx = setup(); const turn = await ctx.service.organize({ content: 'Prova de Redes sexta e 5 horas' }); const saved = turn.result.actions[0]!; expect(JSON.parse((saved.payload as any).details)).toMatchObject({ estimatedMinutes: 300 }); expect(ctx.proposed.filter((item) => item.type === 'plan.recalculate')).toHaveLength(0); ctx.service.onPlannerActionResolved({ ...saved, status: 'applied', result: academicEvent({ workspaceId: null }), resolvedAt: 2 }); expect(ctx.proposed.filter((item) => item.type === 'plan.recalculate')).toHaveLength(0); const link = { ...saved, id: crypto.randomUUID(), type: 'academic.event.linkWorkspace' as const, payload: { eventId: academicEvent().id, workspaceId: crypto.randomUUID(), subject: 'Redes' }, result: academicEvent({ workspaceId: crypto.randomUUID() }), resolvedAt: 3 }; ctx.service.onPlannerActionResolved({ ...link, status: 'applied' }); ctx.service.onPlannerActionResolved({ ...link, status: 'applied' }); expect(ctx.proposed.filter((item) => item.type === 'plan.recalculate')).toEqual([expect.objectContaining({ idempotencyScope: 'organizer:event-replan:' + link.id, label: expect.stringMatching(/vincular/) })]) })
  it('creates no link follow-up for rejection or duplicate budget replan', async () => { const ctx = setup(); const base = { id: crypto.randomUUID(), originMessageId: crypto.randomUUID(), label: 'link', contextVersion: 1, type: 'academic.event.linkWorkspace' as const, status: 'rejected' as const, payload: { eventId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), subject: 'Redes' }, result: null, createdAt: 1, resolvedAt: 2 }; ctx.service.onPlannerActionResolved(base); expect(ctx.proposed).toHaveLength(0); const budget = (await ctx.service.organize({ content: '30 min hoje. Reorganize' })).result.actions[0]!; ctx.service.onPlannerActionResolved({ ...budget, status: 'applied', resolvedAt: 4 }); expect(ctx.proposed.filter((item) => item.type === 'plan.recalculate')).toHaveLength(0) })
  it('replans only after a confirmed linked reschedule or archived cancellation', () => { const workspaceId = '00000000-0000-4000-8000-000000000011'; const linked = academicEvent({ workspaceId }); const unlinked = academicEvent({ id: '00000000-0000-4000-8000-000000000012' }); const ctx = setup(); const save = { id: '00000000-0000-4000-8000-000000000013', originMessageId: crypto.randomUUID(), label: 'reschedule', contextVersion: 1, type: 'academic-life.save' as const, status: 'applied' as const, payload: { kind: 'event', workspaceId, timezone: 'UTC' }, result: linked, createdAt: 1, resolvedAt: 2 }; const transition = (id: string, status: 'resolved' | 'archived', result: any) => ({ id, originMessageId: crypto.randomUUID(), label: status, contextVersion: 1, type: 'academic-life.transition' as const, status: 'applied' as const, payload: { id: result.id, status }, result, createdAt: 1, resolvedAt: 2 }); ctx.service.onPlannerActionResolved(save); ctx.service.onPlannerActionResolved(transition('00000000-0000-4000-8000-000000000014', 'resolved', linked)); ctx.service.onPlannerActionResolved(transition('00000000-0000-4000-8000-000000000015', 'archived', linked)); ctx.service.onPlannerActionResolved(transition('00000000-0000-4000-8000-000000000016', 'archived', unlinked)); expect(ctx.proposed.filter((item) => item.type === 'plan.recalculate')).toEqual([expect.objectContaining({ label: 'Recalcular o plano após atualizar o evento' }), expect.objectContaining({ label: 'Recalcular o plano após cancelar o evento' })]) })
  it('creates tomorrow exam with authoritative date but waits for a Workspace link before replan', async () => { const ctx = setup(); const turn = await ctx.service.organize({ content: 'Tenho prova de POO amanhã, priorize' }); expect(turn.result.actions[0], JSON.stringify(turn.result)).toMatchObject({ type: 'academic-life.save', payload: { workspaceId: null, endsAt: Date.UTC(2026, 8, 8, 23, 59) } }); expect(ctx.proposed).toHaveLength(1); ctx.service.onPlannerActionResolved({ ...turn.result.actions[0]!, status: 'applied', result: academicEvent(), resolvedAt: 2 }); expect(ctx.proposed.filter((item) => item.type === 'plan.recalculate')).toHaveLength(0) })
  it('creates a validated PlannerAction with the exact natural time in America/Bahia', async () => { const ctx = setup({ currentDate: '2026-09-12', timezone: 'America/Bahia' }); const turn = await ctx.service.organize({ content: 'Tenho prova de POO hoje às 5 da tarde' }); expect(turn.result.actions).toEqual([expect.objectContaining({ type: 'academic-life.save', payload: expect.objectContaining({ timezone: 'America/Bahia', endsAt: Date.parse('2026-09-12T20:00:00Z'), expiresAt: Date.parse('2026-09-12T20:00:00Z') }) })]); expect(ctx.planningWrites()).toBe(0) })
  it('does not treat 18h as study effort when creating a tomorrow exam', async () => {
    const ctx =
      setup({
        currentDate:
          '2026-09-20',

        timezone:
          'America/Bahia',
      })

    const turn =
      await ctx.service.organize({
        content:
          'tenho prova de POO amanhã às 18h',
      })

    expect(
      turn.result.actions[0],
      JSON.stringify(
        turn.result,
      ),
    ).toMatchObject({
      type:
        'academic-life.save',

      payload: {
        title:
          'Prova POO',

        timezone:
          'America/Bahia',

        endsAt:
          Date.parse(
            '2026-09-21T21:00:00Z',
          ),

        expiresAt:
          Date.parse(
            '2026-09-21T21:00:00Z',
          ),
      },
    })

    const details =
      JSON.parse(
        (
          turn.result
            .actions[0]!
            .payload as {
              details: string
            }
        ).details,
      )

    expect(
      details,
    ).not.toHaveProperty(
      'estimatedMinutes',
    )
  })

  it('uses deterministic parsing for a complete absolute timed exam without asking the provider to reinterpret it', async () => {
    let providerCalls =
      0

    const provider = {
      sendMessage:
        async () => {
          providerCalls +=
            1

          throw new Error(
            'provider should not be called for a complete deterministic academic event',
          )
        },
    }

    const ctx =
      setup({
        currentDate:
          '2026-09-20',

        timezone:
          'America/Bahia',

        interpreter:
          new ProviderOrganizerIntentInterpreter(
            {
              route:
                () => provider,
            } as any,
          ),
      })

    const turn =
      await ctx.service.organize({
        content:
          'tenho prova de POO dia 22 as 8 horas',
      })

    expect(
      providerCalls,
    ).toBe(0)

    expect(
      turn.result.actions[0],
      JSON.stringify(
        turn.result,
      ),
    ).toMatchObject({
      type:
        'academic-life.save',

      payload: {
        title:
          'Prova POO',

        timezone:
          'America/Bahia',

        endsAt:
          Date.parse(
            '2026-09-22T11:00:00Z',
          ),

        expiresAt:
          Date.parse(
            '2026-09-22T11:00:00Z',
          ),
      },
    })

    const details =
      JSON.parse(
        (
          turn.result
            .actions[0]!
            .payload as {
              details: string
            }
        ).details,
      )

    expect(
      details,
    ).toMatchObject({
      eventKind:
        'exam',

      subject:
        'POO',
    })

    expect(
      details,
    ).not.toHaveProperty(
      'estimatedMinutes',
    )
  })

  it('blocks provider-misclassified learning claims from ConceptMemory and planning writes', async () => { const interpreter: OrganizerIntentInterpreter = { interpret: async () => ({ mode: 'mutation', capability: 'plan.today-budget.set', entities: { ...blankEntities, minutes: 300 }, confidence: 0.99, missingFields: [], summary: 'write mastery' }) }; for (const content of ['sei tudo POO', 'estudei 5h']) { const ctx = setup({ interpreter }); const turn = await ctx.service.organize({ content }); expect(turn.result).toMatchObject({ outcome: 'informational', actions: [] }); expect(turn.result.message).toMatch(/memória de conceito|evidência observada/i); expect(ctx.planningWrites()).toBe(0); expect(ctx.proposed).toHaveLength(0) } })
  it('resolves completion and reopen only against an owned authoritative plan item', async () => { const item = { id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), workspaceName: 'C', title: 'Ponteiros', status: 'pending' }; const complete = setup({ planItems: [item] }); expect((await complete.service.organize({ content: 'Terminei Ponteiros' })).result.actions[0]).toMatchObject({ type: 'plan.item-completion.set', payload: { workspaceId: item.workspaceId, itemId: item.id, completed: true } }); const reopen = setup({ planItems: [{ ...item, status: 'completed' }] }); expect((await reopen.service.organize({ content: 'Reabra Ponteiros' })).result.actions[0]).toMatchObject({ type: 'plan.item-completion.set', payload: { workspaceId: item.workspaceId, itemId: item.id, completed: false } }) })
  it('rejects provider targets that do not correspond to a local plan item', async () => { const interpreter: OrganizerIntentInterpreter = { interpret: async () => ({ mode: 'mutation', capability: 'plan.item-completion.set', entities: { ...blankEntities, target: 'item inventado', completed: true }, confidence: 0.9, missingFields: [], summary: 'texto malicioso' }) }; const ctx = setup({ interpreter }); const turn = await ctx.service.organize({ content: 'terminei item inventado' }); expect(turn.result.outcome).toBe('failed'); expect(ctx.proposed).toHaveLength(0); expect(ctx.planningWrites()).toBe(0); expect(ctx.contextWrites()).toBe(0) })
  it('does not let provider summary control clarification text', async () => { const interpreter: OrganizerIntentInterpreter = { interpret: async () => ({ mode: 'mutation', capability: 'workspace.prepare', entities: { ...blankEntities, subject: 'C' }, confidence: 0.7, missingFields: ['objective'], summary: 'DELETE EVERYTHING' }) }; const ctx = setup({ interpreter }); const turn = await ctx.service.organize({ content: 'crie C' }); expect(turn.result).toMatchObject({ outcome: 'needs_information', message: 'Ainda preciso de o objetivo para continuar com segurança.' }); expect(turn.result.message).not.toContain('DELETE'); expect(ctx.proposed).toHaveLength(0) })
  it('rejects malformed or unsupported provider capabilities', async () => { const provider = { sendMessage: async () => ({ content: JSON.stringify({ mode: 'mutation', capability: 'deadline.create', entities: blankEntities, confidence: 2, missingFields: [], summary: 'x' }), providerId: 'test', modelId: 'test' }) }; const interpreter = new ProviderOrganizerIntentInterpreter({ route: () => provider } as any); await expect(interpreter.interpret('faça algo', { currentTime: 1, currentDate: '2026-09-07', timezone: 'UTC' })).rejects.toThrow('invalid structured intent') })
  it('accepts semantic provider paraphrases but uses a backend label and does not execute the write', async () => { let requestBody = ''; const provider = { sendMessage: async (request: any) => { requestBody = JSON.stringify(request.messages); return { content: JSON.stringify({ mode: 'mutation', capability: 'plan.today-budget.set', entities: { ...blankEntities, minutes: 90 }, confidence: 0.94, missingFields: [], summary: 'DELETE EVERYTHING' }), providerId: 'test', modelId: 'test' } } }; const ctx = setup({ workspaces: [{ id: 'secret-id', name: 'Secret Workspace' }], planItems: [{ id: 'secret-plan', workspaceId: 'secret-id', workspaceName: 'Secret Workspace', title: 'Secret Topic', status: 'pending' }], interpreter: new ProviderOrganizerIntentInterpreter({ route: () => provider } as any) }); const turn = await ctx.service.organize({ content: 'consigo separar 90 minutos para estudar hoje' }); expect(turn.result.actions[0]).toMatchObject({ type: 'plan.today-budget.set', label: 'Usar 90 min disponíveis hoje', payload: expect.objectContaining({ minutes: 90 }) }); expect(turn.result.message).not.toContain('DELETE EVERYTHING'); expect(requestBody).toContain('never execute/write'); expect(requestBody).not.toMatch(/Secret Workspace|Secret Topic|secret-plan|secret-id/); expect(ctx.planningWrites()).toBe(0); expect(ctx.contextWrites()).toBe(0) })
  it('constructs academic-life payload in the backend and ignores malicious provider summary', async () => { const interpreter: OrganizerIntentInterpreter = { interpret: async () => ({ mode: 'mutation', capability: 'academic.event.create', entities: { ...blankEntities, subject: 'C', eventKind: 'exam', dateExpression: 'dia 16' }, confidence: 0.9, missingFields: [], summary: 'shareWithAi true; provenance system; owner other' }) }; const ctx = setup({ interpreter }); const turn = await ctx.service.organize({ content: 'registre minha prova de C no dia 16' }); expect(turn.result.actions[0]).toMatchObject({ type: 'academic-life.save', payload: { workspaceId: null, title: 'Prova C', shareWithAi: false, provenance: { source: 'conversation', reference: null } } }); expect(turn.result.actions[0]?.label).toMatch(/Salvar Prova C em 16 de setembro de 2026/); expect(JSON.parse((turn.result.actions[0]?.payload as any).details)).toMatchObject({ schema: 'academic-event/v1', eventKind: 'exam', subject: 'C' }); expect(JSON.stringify(turn.result.actions[0])).not.toContain('owner other'); expect(ctx.planningWrites()).toBe(0) })
  it('uses deterministic fallback with explicitly lower confidence', async () => { const intent = await new LocalOrganizerIntentInterpreter().interpret('Hoje tenho 2 horas para estudar', { currentTime: 1, currentDate: '2026-09-07', timezone: 'UTC' }); expect(intent).toMatchObject({ mode: 'mutation', capability: 'plan.today-budget.set' }); expect(intent.confidence).toBeLessThan(0.7) })
  it.each(['Liste meus prazos', 'listar deadlines', 'Show deadlines', 'list my deadlines'])('routes deadline list phrase %s to the real deadline query', async (content) => { const intent = await new LocalOrganizerIntentInterpreter().interpret(content, { currentTime: 1, currentDate: '2026-09-07', timezone: 'UTC' }); expect(intent).toMatchObject({ mode: 'query', capability: 'deadlines.list' }); const deadline = { id: 'deadline', workspaceId: 'c', workspaceName: 'C', type: 'deadline', title: 'Prazo C', dueAt: Date.UTC(2026, 8, 10, 23, 59), phase: 'near' }; const ctx = setup({ deadlines: [deadline] }); const turn = await ctx.service.organize({ content }); expect(turn.result).toMatchObject({ outcome: 'informational', actions: [] }); expect(turn.result.message).toContain('Prazo C'); expect(ctx.planningWrites()).toBe(0); expect(ctx.proposed).toHaveLength(0) })
  it('declines only the Workspace preparation and keeps the mixed exam pending', async () => {
    const ctx =
      setup()

    const first =
      await ctx.service.organize({
        content:
          'eu vou ter prova de python de dados, e quero aprender javascript',
      })

    expect(
      first.result.message,
    ).toMatch(
      /Prova de python de dados.*data/i,
    )

    expect(
      first.result.message,
    ).toMatch(
      /Workspace de javascript/i,
    )

    expect(
      ctx.state(),
    ).toMatchObject({
      pending: {
        capability:
          'academic.event.create',

        entities: {
          subject:
            'python de dados',

          eventKind:
            'exam',
        },

        missingFields:
          ['dateExpression'],
      },

      pendingWorkspacePreparation: {
        subject:
          'javascript',
      },
    })

    const decline =
      await ctx.service.organize({
        content:
          'nao',
      })

    expect(
      decline.result,
    ).toMatchObject({
      outcome:
        'needs_information',

      actions:
        [],
    })

    expect(
      decline.result.message,
    ).toMatch(
      /não vou preparar o Workspace de javascript/i,
    )

    expect(
      decline.result.message,
    ).toMatch(
      /prova de python de dados continua pendente.*data/i,
    )

    expect(
      ctx.state().pending,
    ).toMatchObject({
      capability:
        'academic.event.create',

      entities: {
        subject:
          'python de dados',
      },

      missingFields:
        ['dateExpression'],
    })

    expect(
      ctx.state()
        .pendingWorkspacePreparation,
    ).toBeNull()

    expect(
      ctx.proposed,
    ).toHaveLength(0)
  })

  it('keeps the exam pending while preparing a requested Workspace in a later confirmation', async () => {
    const ctx =
      setup()

    const first =
      await ctx.service.organize({
        content:
          'eu vou ter prova de python de dados, e quero aprender javascript',
      })

    expect(
      first.result.outcome,
    ).toBe(
      'needs_information',
    )

    expect(
      ctx.state(),
    ).toMatchObject({
      pending: {
        capability:
          'academic.event.create',

        entities: {
          subject:
            'python de dados',

          eventKind:
            'exam',
        },

        missingFields:
          ['dateExpression'],
      },

      pendingWorkspacePreparation: {
        subject:
          'javascript',
      },
    })

    expect(
      ctx.proposed,
    ).toHaveLength(0)

    const second =
      await ctx.service.organize({
        content:
          'quero',
      })

    expect(
      second.result.actions[0],
    ).toMatchObject({
      type:
        'workspace.prepare',

      payload: {
        name:
          'javascript',

        objective:
          'Preparação acadêmica em javascript',
      },
    })

    expect(
      ctx.state().pending,
    ).toMatchObject({
      capability:
        'academic.event.create',

      entities: {
        subject:
          'python de dados',
      },

      missingFields:
        ['dateExpression'],
    })

    expect(
      ctx.state()
        .pendingWorkspacePreparation,
    ).toBeNull()

    const workspaceAction =
      second.result.actions[0]!

    ctx.service.onPlannerActionResolved({
      ...workspaceAction,
      status:
        'rejected',
      result:
        null,
      resolvedAt:
        2,
    })

    /*
     * Descartar a criação do Workspace NÃO pode
     * apagar a prova que ainda precisa da data.
     */
    expect(
      ctx.state().pending,
    ).toMatchObject({
      capability:
        'academic.event.create',

      entities: {
        subject:
          'python de dados',
      },
    })
  })

  it('requires the action button even when a pending action exists', async () => { const ctx = setup({ pending: [{ id: 'a', label: 'Criar C', originMessageId: 'm' }] }); const turn = await ctx.service.organize({ content: 'sim' }); expect(turn.result.message).toContain('só pode ser executada pelo botão'); expect(ctx.proposed).toHaveLength(0) })
  it('proposes a unique 21 to 24 replacement from authoritative local candidates', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000011'; const event = academicEvent({ id: '00000000-0000-4000-8000-000000000021', title: 'Prova C', workspaceId, endsAt: Date.UTC(2026, 8, 21, 23, 59), expiresAt: Date.UTC(2026, 8, 21, 23, 59) })
    const ctx = setup({ academicLife: [event] }); const turn = await ctx.service.organize({ content: 'a prova de C mudou de dia 21 para dia 24' })
    expect(turn.result.actions[0]).toMatchObject({ type: 'academic-life.save', payload: { workspaceId, replacesId: event.id, endsAt: Date.UTC(2026, 8, 24, 23, 59) } })
  })
  it('requires both original and new dates for an update', async () => { const event = academicEvent({ id: '00000000-0000-4000-8000-000000000025', title: 'Prova C' }); const ctx = setup({ academicLife: [event] }); const turn = await ctx.service.organize({ content: 'a prova de C foi remarcada para dia 24' }); expect(turn.result).toMatchObject({ outcome: 'needs_information', actions: [] }); expect(ctx.proposed).toHaveLength(0) })
  it('proposes cancellation only for one authoritative candidate', async () => {
    const event = academicEvent({ id: '00000000-0000-4000-8000-000000000022', title: 'Prova C' }); const ctx = setup({ academicLife: [event] })
    expect((await ctx.service.organize({ content: 'cancele a prova de C' })).result.actions[0]).toMatchObject({ type: 'academic-life.transition', payload: { id: event.id, status: 'archived' } })
  })
  it('clarifies ambiguous and missing event candidates without proposing writes', async () => {
    const first = academicEvent({ id: '00000000-0000-4000-8000-000000000023', title: 'Prova C' }); const second = academicEvent({ id: '00000000-0000-4000-8000-000000000024', title: 'Prova C', endsAt: Date.UTC(2026, 9, 1, 23, 59) })
    const ambiguous = setup({ academicLife: [first, second] }); expect((await ambiguous.service.organize({ content: 'cancele a prova de C' })).result.message).toMatch(/mais de um/i); expect(ambiguous.proposed).toHaveLength(0)
    const missing = setup(); expect((await missing.service.organize({ content: 'cancele a prova de C' })).result.message).toMatch(/não encontrei/i); expect(missing.proposed).toHaveLength(0)
  })
  it('does not confuse a short subject with another event title', async () => { const ctx = setup({ academicLife: [academicEvent({ title: 'Prova Cálculo' })] }); const turn = await ctx.service.organize({ content: 'cancele a prova de C' }); expect(turn.result.message).toMatch(/não encontrei/i); expect(ctx.proposed).toHaveLength(0) })
  it('distinguishes exam and deadline subtypes for the same subject', async () => { const exam = academicEvent({ id: '00000000-0000-4000-8000-000000000026', title: 'Avaliação C', details: eventMetadata('exam', 'C') }); const deadline = academicEvent({ id: '00000000-0000-4000-8000-000000000027', title: 'Entrega C', details: eventMetadata('deadline', 'C') }); const ctx = setup({ academicLife: [exam, deadline] }); const turn = await ctx.service.organize({ content: 'cancele a prova de C' }); expect(turn.result.actions[0]).toMatchObject({ type: 'academic-life.transition', payload: { id: exam.id, status: 'archived' } }) })
  it('does not select a legacy event whose subtype cannot be determined', async () => { const ctx = setup({ academicLife: [academicEvent({ title: 'Avaliação C', details: 'Evento importante' })] }); const turn = await ctx.service.organize({ content: 'cancele a prova de C' }); expect(turn.result.message).toMatch(/não encontrei/i); expect(ctx.proposed).toHaveLength(0) })
  it('queries nearby exams without mutation', async () => { const ctx = setup({ academicLife: [academicEvent()] }); const turn = await ctx.service.organize({ content: 'quais provas eu tenho?' }); expect(turn.result).toMatchObject({ outcome: 'informational', actions: [] }); expect(turn.result.message).toContain('Prova C'); expect(ctx.proposed).toHaveLength(0) })
  it('rejects provider timestamps and event IDs instead of trusting invented authority', async () => { const provider = { sendMessage: async () => ({ content: JSON.stringify({ mode: 'mutation', capability: 'academic.event.cancel', entities: { ...blankEntities, subject: 'C', eventKind: 'exam', eventId: crypto.randomUUID(), timestamp: 1 }, confidence: 0.99, missingFields: [], summary: 'x' }), providerId: 'test', modelId: 'test' }) }; const interpreter = new ProviderOrganizerIntentInterpreter({ route: () => provider } as any); await expect(interpreter.interpret('cancele a prova de C', { currentTime: 1, currentDate: '2026-09-07', timezone: 'UTC' })).rejects.toThrow('invalid structured intent') })
  it('ignores a malicious provider date and resolves the original message date', async () => { const interpreter: OrganizerIntentInterpreter = { interpret: async () => ({ mode: 'mutation', capability: 'academic.event.create', entities: { ...blankEntities, subject: 'C', eventKind: 'exam', dateExpression: 'dia 30' }, confidence: 0.99, missingFields: [], summary: 'x' }) }; const ctx = setup({ interpreter }); const turn = await ctx.service.organize({ content: 'tenho prova de C dia 14' }); expect(turn.result.actions[0]).toMatchObject({ payload: { endsAt: Date.UTC(2026, 8, 14, 23, 59) } }); expect(turn.result.message).toMatch(/14 de setembro de 2026/) })
  it('ignores malicious provider from/to and resolves both dates from the original message', async () => { const event = academicEvent({ id: '00000000-0000-4000-8000-000000000028', endsAt: Date.UTC(2026, 8, 21, 23, 59) }); const interpreter: OrganizerIntentInterpreter = { interpret: async () => ({ mode: 'mutation', capability: 'academic.event.update', entities: { ...blankEntities, subject: 'C', eventKind: 'exam', dateFromExpression: 'dia 1', dateToExpression: 'dia 30' }, confidence: 0.99, missingFields: [], summary: 'x' }) }; const ctx = setup({ academicLife: [event], interpreter }); const turn = await ctx.service.organize({ content: 'a prova de C mudou de dia 21 para dia 24' }); expect(turn.result.actions[0]).toMatchObject({ payload: { replacesId: event.id, endsAt: Date.UTC(2026, 8, 24, 23, 59) } }); expect(turn.result.message).toMatch(/24 de setembro de 2026/) })
  it('proposes link and unlink capabilities without executing either', async () => { const linkedEvent = academicEvent({ workspaceId: '00000000-0000-4000-8000-000000000011' }); const link = setup({ workspaces: [{ id: '00000000-0000-4000-8000-000000000011', name: 'Java' }], academicLife: [academicEvent()] }); expect((await link.service.organize({ content: 'vincule a prova de C ao workspace Java' })).result.actions[0]).toMatchObject({ type: 'academic.event.linkWorkspace', payload: { eventId: academicEvent().id, workspaceId: '00000000-0000-4000-8000-000000000011' } }); const unlink = setup({ workspaces: [{ id: '00000000-0000-4000-8000-000000000011', name: 'Java' }], academicLife: [linkedEvent] }); expect((await unlink.service.organize({ content: 'deixe a prova de C sem workspace' })).result.actions[0]).toMatchObject({ type: 'academic.event.unlinkWorkspace', payload: { eventId: linkedEvent.id } }); expect(link.proposed).toHaveLength(1); expect(unlink.proposed).toHaveLength(1) })
  it('completes a pending exam date and keeps the original message origin', async () => { const ctx = setup(); const first = await ctx.service.organize({ content: 'Tenho prova de POO' }); expect(first.result).toMatchObject({ outcome: 'needs_information', actions: [] }); const originalMessageId = ctx.state().pending.originalMessageId; expect(ctx.state().pending).toMatchObject({ capability: 'academic.event.create', missingFields: ['dateExpression'], originalText: 'Tenho prova de POO' }); const second = await ctx.service.organize({ content: 'dia 14' }); expect(second.result.actions[0]).toMatchObject({ type: 'academic-life.save', originMessageId: originalMessageId, payload: { title: 'Prova POO', endsAt: Date.UTC(2026, 8, 14, 23, 59) } }); expect(ctx.state().pending).toBeNull() })
  it('abandons pending when a complete new event overrides it', async () => { const ctx = setup(); await ctx.service.organize({ content: 'Tenho prova de POO' }); const originalMessageId = ctx.state().pending.originalMessageId; const turn = await ctx.service.organize({ content: 'prova de C dia 20' }); expect(turn.result.actions[0]).toMatchObject({ type: 'academic-life.save', payload: { title: 'Prova C', endsAt: Date.UTC(2026, 8, 20, 23, 59) } }); expect(turn.result.actions[0]?.originMessageId).not.toBe(originalMessageId); expect(ctx.state().pending).toBeNull() })
  it('expires pending deterministically across restart and never treats a date as the old intent', async () => { const originalCreatedAt = Date.UTC(2026, 8, 6, 11); const state = { ...emptyOrganizerConversationState(), pending: { capability: 'academic.event.create', entities: { ...blankEntities, subject: 'POO', eventKind: 'exam' }, missingFields: ['dateExpression'], originalMessageId: '00000000-0000-4000-8000-000000000080', originalText: 'Tenho prova de POO', originalCreatedAt, originalCurrentDate: '2026-09-06', originalTimezone: 'America/Sao_Paulo' }, updatedAt: originalCreatedAt }; const ctx = setup({ state, currentTime: Date.UTC(2026, 8, 7, 12) }); const turn = await ctx.service.organize({ content: 'dia 14' }); expect(turn.result).toMatchObject({ actions: [] }); expect(ctx.state().pending).toBeNull(); expect(ctx.proposed).toHaveLength(0) })
  it('updates focus only after a confirmed academic action result', () => { const event = academicEvent({ id: '00000000-0000-4000-8000-000000000099', details: eventMetadata('exam', 'POO') }); const ctx = setup(); ctx.service.onPlannerActionResolved({ id: crypto.randomUUID(), originMessageId: crypto.randomUUID(), label: 'Salvar', contextVersion: 1, type: 'academic-life.save', status: 'applied', payload: {}, result: event, createdAt: 1, resolvedAt: 2 }); expect(ctx.state()).toMatchObject({ focusedAcademicEventId: event.id, focusedSubject: 'POO', recentResolvedAcademicEventIds: [event.id] }) })
  it('uses a unique revalidated focused exam for cancellation but clarifies two recent exams', async () => { const exam = academicEvent({ id: '00000000-0000-4000-8000-000000000090', details: eventMetadata('exam', 'POO'), title: 'Prova POO' }); const focused = { ...emptyOrganizerConversationState(), focusedAcademicEventId: exam.id, focusedSubject: 'POO', recentResolvedAcademicEventIds: [exam.id], updatedAt: 1 }; const unique = setup({ academicLife: [exam], state: focused }); expect((await unique.service.organize({ content: 'A prova foi cancelada' })).result.actions[0]).toMatchObject({ type: 'academic-life.transition', payload: { id: exam.id } }); const other = academicEvent({ id: '00000000-0000-4000-8000-000000000091', details: eventMetadata('exam', 'C'), title: 'Prova C' }); const ambiguous = setup({ academicLife: [exam, other], state: { ...focused, recentResolvedAcademicEventIds: [exam.id, other.id] } }); expect((await ambiguous.service.organize({ content: 'cancele isso' })).result).toMatchObject({ actions: [] }) })
  it('keeps generic pronouns ambiguous across mixed event kinds and lets typed references filter', async () => { const exam = academicEvent({ id: '00000000-0000-4000-8000-000000000095', details: eventMetadata('exam', 'POO'), title: 'Prova POO' }); const assignment = academicEvent({ id: '00000000-0000-4000-8000-000000000096', kind: 'commitment', details: eventMetadata('assignment', 'C'), title: 'Trabalho C' }); const state = { ...emptyOrganizerConversationState(), focusedAcademicEventId: exam.id, focusedSubject: 'POO', recentResolvedAcademicEventIds: [exam.id, assignment.id], updatedAt: 1 }; const generic = setup({ academicLife: [exam, assignment], state }); expect((await generic.service.organize({ content: 'cancele isso' })).result).toMatchObject({ outcome: 'needs_information', actions: [] }); const typedExam = setup({ academicLife: [exam, assignment], state }); expect((await typedExam.service.organize({ content: 'a prova foi cancelada' })).result.actions[0]).toMatchObject({ type: 'academic-life.transition', payload: { id: exam.id } }); const typedAssignment = setup({ academicLife: [exam, assignment], state }); expect((await typedAssignment.service.organize({ content: 'cancele esse trabalho' })).result.actions[0]).toMatchObject({ type: 'academic-life.transition', payload: { id: assignment.id } }) })
  it('lets an explicit current subject override focused context', async () => { const poo = academicEvent({ id: '00000000-0000-4000-8000-000000000092', title: 'Prova POO', details: eventMetadata('exam', 'POO') }); const c = academicEvent({ id: '00000000-0000-4000-8000-000000000093', title: 'Prova C', details: eventMetadata('exam', 'C') }); const state = { ...emptyOrganizerConversationState(), focusedAcademicEventId: poo.id, focusedSubject: 'POO', recentResolvedAcademicEventIds: [poo.id], updatedAt: 1 }; const ctx = setup({ academicLife: [poo, c], state }); expect((await ctx.service.organize({ content: 'cancele a prova de C' })).result.actions[0]).toMatchObject({ payload: { id: c.id } }) })
  it('removes stale focused IDs after restart instead of inventing a candidate', async () => { const stale = '00000000-0000-4000-8000-000000000094'; const ctx = setup({ state: { ...emptyOrganizerConversationState(), focusedAcademicEventId: stale, focusedSubject: 'POO', recentResolvedAcademicEventIds: [stale], updatedAt: 1 } }); const turn = await ctx.service.organize({ content: 'cancele isso' }); expect(turn.result).toMatchObject({ outcome: 'needs_information', actions: [] }); expect(ctx.state()).toMatchObject({ focusedAcademicEventId: null, recentResolvedAcademicEventIds: [] }); expect(ctx.proposed).toHaveLength(0) })
  it('clears stale conversation authority on rejection and creates a fresh equivalent proposal later', async () => { const stale = crypto.randomUUID(); const ctx = setup({ state: { ...emptyOrganizerConversationState(), focusedAcademicEventId: stale, focusedSubject: 'C', pending: { capability: 'academic.event.create', entities: blankEntities, missingFields: ['dateExpression'], originalMessageId: crypto.randomUUID(), originalText: 'prova', originalCreatedAt: 1, originalCurrentDate: '2026-09-07', originalTimezone: 'UTC' }, recentResolvedAcademicEventIds: [stale], updatedAt: 1 } }); const first = await ctx.service.organize({ content: 'tenho prova de C dia 14' }); const rejected = { ...first.result.actions[0]!, status: 'rejected' as const, result: null, resolvedAt: 2 }; ctx.service.onPlannerActionResolved(rejected); expect(ctx.state()).toMatchObject({ pending: null, focusedAcademicEventId: null, focusedSubject: null, recentResolvedAcademicEventIds: [] }); const second = await ctx.service.organize({ content: 'tenho prova de C dia 14' }); expect(second.result.actions[0]?.id).not.toBe(first.result.actions[0]?.id); expect(ctx.planningWrites()).toBe(0) })
})

function academicEvent(overrides: Record<string, unknown> = {}) { return { id: '00000000-0000-4000-8000-000000000020', kind: 'event', status: 'active', title: 'Prova C', details: '', workspaceId: null, startsAt: null, endsAt: Date.UTC(2026, 8, 14, 23, 59), expiresAt: Date.UTC(2026, 8, 14, 23, 59), timezone: 'UTC', weekday: null, minutes: null, shareWithAi: true, provenance: { source: 'conversation', reference: null }, replacesId: null, replacedById: null, createdAt: 1, updatedAt: 1, resolvedAt: null, archivedAt: null, ...overrides } }
function eventMetadata(eventKind: 'exam' | 'assignment' | 'deadline', subject: string) { return JSON.stringify({ schema: 'academic-event/v1', eventKind, subject, sourceText: 'test' }) }
