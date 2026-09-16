import { describe, expect, it } from 'vitest'
import { activateExerciseAdaptationInputSchema, simplifyExerciseInputSchema } from '../../src/shared/contracts/exercise-contract'
import { EXERCISE_GENERATION_MAX_OUTPUT_TOKENS, EXERCISE_REPAIR_MAX_OUTPUT_TOKENS, ExerciseService, expandCompactExerciseSet, type ExerciseRepository, type PrivateExercise } from '../../src/application/exercises/exercise-service'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import type { ExerciseAdaptation, ExerciseExecution, ExerciseSet, PublicExerciseContext } from '../../src/shared/contracts/exercise-contract'
import { streamWorkspaceMessageInputSchema } from '../../src/shared/contracts/conversation-contract'

class MemoryRepository implements ExerciseRepository {
  projectSets() { return [] }
  set: ExerciseSet | null = null
  exercise: PrivateExercise | null = null
  attempts = new Map<string, ExerciseExecution>()
  findSet(): ExerciseSet | null { return this.set }
  findPrivateExercise(): PrivateExercise | null { return this.exercise }
  findPublicContext(): PublicExerciseContext | null { return null }
  saveDraft(): void {}
  markGenerating(input: { id: string; workspaceId: string; roadmapId: string; moduleId: string; topicId: string; lessonId: string; now: number }): void { this.set = { ...input, status: 'generating', retryAfter: null, lastErrorCode: null, exercises: [], progress: [], updatedAt: input.now } }
  markGenerationFailure(_workspaceId: string, _topicId: string, status: 'waiting_for_provider' | 'failed_retryable', code: string, retryAfter: number, now: number): ExerciseSet { this.set = { ...this.set!, status, lastErrorCode: code, retryAfter, updatedAt: now }; return this.set }
  saveGenerated(input: { setId: string; workspaceId: string; topicId: string; providerId: string; modelId: string; exercises: PrivateExercise[]; now: number }): ExerciseSet { this.exercise = input.exercises[0]!; this.set = { ...this.set!, status: 'ready', retryAfter: null, lastErrorCode: null, exercises: input.exercises.map(({ hiddenTests: _h, referenceSolution: _r, expectedPrediction: _p, hint: _hint, setId: _s, workspaceId: _w, topicId: _t, ...item }) => item), progress: [], updatedAt: input.now }; return this.set }
  saveRun(): void {}
  findAttempt(_workspaceId: string, key: string, exerciseId: string, sourceRevision: string): ExerciseExecution | null { const result = this.attempts.get(key) ?? null; if (result && (result.exerciseId !== exerciseId || sourceRevision !== '5694d08a2e53ffca')) throw new Error('Idempotency key was already used for a different submission'); return result }
  saveSubmission(input: { idempotencyKey: string; execution: ExerciseExecution }): ExerciseExecution { this.attempts.set(input.idempotencyKey, input.execution); return input.execution }
  adaptations: ExerciseAdaptation[] = []
  createAdaptation(input: { id: string; workspaceId: string; exerciseId: string; requestId: string; adapted: ExerciseAdaptation['adapted']; providerId: string; modelId: string; createdAt: number }): ExerciseAdaptation { const exercise=this.exercise!; const item={...input,revision:this.adaptations.length+1,original:{title:exercise.title,statement:exercise.statement,inputDescription:exercise.inputDescription,outputDescription:exercise.outputDescription,predictionPrompt:exercise.predictionPrompt},isActive:true}; this.adaptations=this.adaptations.map((old)=>({...old,isActive:false})); this.adaptations.unshift(item); return item }
  listAdaptations(): ExerciseAdaptation[] { return this.adaptations }
  restoreOriginal(): ExerciseSet { return this.set! }
  activateAdaptation(): ExerciseSet { return this.set! }
  getHelpState() { if(!this.exercise)return null; return { exercise:this.exercise, wording:{title:this.exercise.title,statement:this.exercise.statement,inputDescription:this.exercise.inputDescription,outputDescription:this.exercise.outputDescription,predictionPrompt:this.exercise.predictionPrompt}, progress:{exerciseId:this.exercise.id,status:'in_progress' as const,currentCode:this.exercise.starterCode,attempts:0,lastRun:null,lastSubmission:null,passedTests:0,totalTests:0,helpUsed:false,firstTrySuccess:false,helpCount:0,passedAt:null,updatedAt:0} } }
  findHelpResult() { return null }
  helpResults = new Map<string, { exerciseId:string;helpCount:number;helpLevel:number;requestIdentity:string;hint:string }>()
  saveHelpResult(input: { requestId:string;exerciseId:string;requestIdentity:string;helpLevel:number;hint:string }) { const existing=this.helpResults.get(input.requestId); if(existing)return existing; const result={exerciseId:input.exerciseId,helpCount:this.helpResults.size+1,helpLevel:input.helpLevel,requestIdentity:input.requestIdentity,hint:input.hint}; this.helpResults.set(input.requestId,result); return result }
}

const context = { workspaceId: '00000000-0000-4000-8000-000000000001', roadmapId: 'roadmap', moduleId: 'module', topicId: 'module:loops', lessonId: 'lesson' }
const roadmap = { id: 'roadmap', workspaceId: context.workspaceId, title: 'Python', status: 'accepted' as const, generationKind: 'ai_generated' as const, version: 1, providerId: null, modelId: null, createdAt: 1, updatedAt: 1, modules: [{ id: 'module', title: 'Loops', objective: 'Repeat', estimatedMinutes: 10, position: 1, status: 'active' as const, topics: ['loops'], outcomes: ['repeat'], practice: 'sum', completionCriteria: ['tests'], resources: [] }] }
const generatedExercise = (title: string, requiredForTopicCompletion: boolean) => ({ kind: 'PROGRAMMING_PROBLEM', difficulty: 'standard', title, statement: 'Some dois inteiros.', inputDescription: 'Dois inteiros.', outputDescription: 'A soma.', language: 'python', starterCode: 'a,b=map(int,input().split())', predictionPrompt: null, codeToObserve: null, requiredForTopicCompletion, publicTests: [{ input: '1 2\n', expectedOutput: '3' }], hiddenTests: [{ input: '1 2\n', expectedOutput: '3' }, { input: '1 2\n', expectedOutput: '3' }, { input: '1 2\n', expectedOutput: '3' }], referenceSolution: 'a,b=map(int,input().split());print(a+b)', expectedPrediction: null, hint: 'Leia os dois valores.' })
const generated = { exercises: [
  generatedExercise('Somar', true),
  { ...generatedExercise('Corrigir soma', false), kind: 'FIX_CODE', statement: 'Corrija o defeito que subtrai os valores.', starterCode: 'a,b=map(int,input().split());print(a-b)' },
  { ...generatedExercise('Completar soma', false), kind: 'COMPLETE_CODE', starterCode: 'a,b=map(int,input().split())\n# TODO: imprima a soma' },
  { ...generatedExercise('Prever soma', false), kind: 'PREDICT_OUTPUT', inputDescription: '', outputDescription: '', starterCode: '', predictionPrompt: 'Qual saída será exibida?', codeToObserve: 'print(1 + 2)', publicTests: [], hiddenTests: [], referenceSolution: null, expectedPrediction: '3' },
] }

describe('ExerciseService', () => {
  it('accepts exact strict IPC payloads for simplifying and activating adaptations', () => {
    const base = { workspaceId: crypto.randomUUID(), exerciseId: 'exercise-1' }
    expect(simplifyExerciseInputSchema.parse({ ...base, requestId: 'simplify-1' })).toEqual({ ...base, requestId: 'simplify-1' })
    expect(activateExerciseAdaptationInputSchema.parse({ ...base, adaptationId: 'adaptation-1' })).toEqual({ ...base, adaptationId: 'adaptation-1' })
    expect(() => simplifyExerciseInputSchema.parse({ ...base, requestId: 'simplify-1', extra: true })).toThrow()
  })
  it('expands compact exercises without exposing private fields through the public contract', () => {
    const tuple = ['intent', ['concept'], 'PREDICT_OUTPUT', 'standard', 'Preveja', 'Qual saída?', '', '', 'python', '', 'Informe a saída', 'print(2)', true, [], [], null, '2', 'Acompanhe a execução']
    const expanded = expandCompactExerciseSet({ e: [tuple, tuple, tuple, tuple] }) as { exercises: Array<Record<string, unknown>> }
    expect(expanded.exercises[0]).toMatchObject({ assessmentIntentKey: 'intent', conceptKeys: ['concept'], publicTests: [], hiddenTests: [], expectedPrediction: '2' })
  })
  it('uses the worker signal and bounded budgets for initial generation and one repair', async () => {
    const repository = new MemoryRepository(); const requests: import('../../src/application/ai/ai-provider').AIRequest[] = []; const controller = new AbortController()
    const provider = new AIProviderManager(); provider.register({ id: 'p', name: 'p', testConnection: async () => {}, getCapabilities: () => ({ streaming: false, usageInformation: false, supportedInput: ['text'] }), sendMessage: async (request) => { requests.push(request); return { content: requests.length === 1 ? '{"e":[]}' : JSON.stringify(generated), providerId: 'p', modelId: 'm' } } }); provider.select('p')
    const service = new ExerciseService(repository, provider, { getStatuses: () => [{ language: 'python', available: true }], execute: async () => ({ phase: 'run', exitCode: 0, stdout: '3', stderr: '', timedOut: false }) } as never, async () => ({ id: context.workspaceId, name: 'Python', objective: 'Loops', status: 'active', createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }), () => roadmap)
    await service.prepareGeneration({ ...context, revision: 1, inputHash: 'a'.repeat(64) }, controller.signal).catch(() => {})
    expect(requests.map((request) => request.signal)).toEqual([controller.signal, controller.signal])
    expect(requests.map((request) => request.maxOutputTokens)).toEqual([EXERCISE_GENERATION_MAX_OUTPUT_TOKENS, EXERCISE_REPAIR_MAX_OUTPUT_TOKENS])
  })
  it('accepts only the active exercise identifier from the renderer', () => {
    const input = { requestId: crypto.randomUUID(), workspaceId: context.workspaceId, content: 'Ajude', activePage: 'exercises' as const, activeExercise: { exerciseId: 'exercise' } }
    expect(streamWorkspaceMessageInputSchema.parse(input).activeExercise).toEqual({ exerciseId: 'exercise' })
    expect(() => streamWorkspaceMessageInputSchema.parse({ ...input, activeExercise: { exerciseId: 'exercise', currentCode: 'renderer-code', hiddenTests: ['private'] } })).toThrow()
  })

  it('coalesces JIT generation, self-validates, and never exposes private fields', async () => {
    const repository = new MemoryRepository(); const providers = new AIProviderManager(); let calls = 0
    providers.register({ id: 'test', name: 'test', testConnection: async () => {}, getCapabilities: () => ({ streaming: false, usageInformation: false, supportedInput: ['text'] }), sendMessage: async () => { calls++; return { content: JSON.stringify(generated), providerId: 'test', modelId: 'model' } } }); providers.select('test')
    const toolchains = { getStatuses: () => [{ language: 'python' as const, available: true, command: 'python', version: '3', detail: null }], execute: async (candidate: { files: Array<{ content: string }> }, _signal: unknown, stdin: string) => ({ command: 'python', stdout: candidate.files[0]?.content.includes('print(1 + 2)') ? '3\n' : stdin.includes('1 2') ? '3\n' : stdin.includes('5 7') ? '12\n' : stdin.includes('-2') ? '-4\n' : '4\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 1, errorSignature: null, phase: 'run' as const }) }
    const service = new ExerciseService(repository, providers, toolchains as never, async () => ({ id: context.workspaceId, name: 'Python', objective: 'Loops', status: 'active', createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }), () => roadmap, () => 10)
    const [first, second] = await Promise.all([service.ensureSet(context), service.ensureSet(context)])
    expect(calls).toBe(1); expect(first).toEqual(second); expect(JSON.stringify(first)).not.toContain('hiddenTests'); expect(JSON.stringify(first)).not.toContain('referenceSolution'); expect(JSON.stringify(first)).not.toContain('expectedPrediction')
  })

  it('allows only one repair and stores a cooldown after invalid generation', async () => {
    const repository = new MemoryRepository(); const providers = new AIProviderManager(); let calls = 0
    providers.register({ id: 'test', name: 'test', testConnection: async () => {}, getCapabilities: () => ({ streaming: false, usageInformation: false, supportedInput: ['text'] }), sendMessage: async () => { calls++; return { content: JSON.stringify({ exercises: [] }), providerId: 'test', modelId: 'model' } } }); providers.select('test')
    const toolchains = { getStatuses: () => [{ language: 'python' as const, available: true, command: 'python', version: '3', detail: null }], execute: async () => { throw new Error('must not execute') } }
    let now = 100
    const service = new ExerciseService(repository, providers, toolchains as never, async () => ({ id: context.workspaceId, name: 'Python', objective: 'Loops', status: 'active', createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }), () => roadmap, () => now)
    const failed = await service.ensureSet(context)
    expect(calls).toBe(2); expect(failed).toMatchObject({ status: 'failed_retryable', retryAfter: 30_100 })
    now = 200
    expect(await service.ensureSet(context)).toEqual(failed)
    expect(calls).toBe(2)
  })

  it('serializes and replays submit without exposing hidden output or counting run', async () => {
    const repository = new MemoryRepository(); repository.exercise = { id: 'exercise', setId: 'set', workspaceId: context.workspaceId, topicId: context.topicId, position: 1, kind: 'FIX_CODE', difficulty: 'challenge', title: 'Somar', statement: 'Some.', inputDescription: 'in', outputDescription: 'out', language: 'python', starterCode: 'print(0) # bug', predictionPrompt: null, codeToObserve: null, requiredForTopicCompletion: true, publicTests: [{ id: 'public-1', input: '1 2\n', expectedOutput: '3' }], hiddenTests: [{ id: 'hidden-1', input: '5 7\n', expectedOutput: '12' }, { id: 'hidden-2', input: '5 7\n', expectedOutput: '12' }, { id: 'hidden-3', input: '5 7\n', expectedOutput: '12' }], referenceSolution: 'solution', expectedPrediction: null, hint: 'hint' }
    let executions = 0; const toolchains = { getStatuses: () => [{ language: 'python' as const, available: true, command: 'python', version: '3', detail: null }], execute: async (_project: unknown, _signal: unknown, stdin: string) => { executions++; return { command: 'python', stdout: stdin.includes('1 2') ? '3\n' : '11\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 1, errorSignature: null, phase: 'run' as const } } }
    const service = new ExerciseService(repository, new AIProviderManager(), toolchains as never, async () => null, () => null, (() => { let now = 0; return () => ++now })())
    expect(await service.run({ workspaceId: context.workspaceId, exerciseId: 'exercise', code: 'code', stdin: '1 2\n' })).toMatchObject({ mode: 'run', status: 'executed', passed: false }); expect(repository.attempts.size).toBe(0)
    const [first, second] = await Promise.all([service.submit({ workspaceId: context.workspaceId, exerciseId: 'exercise', code: 'code', prediction: null, idempotencyKey: 'same-key' }), service.submit({ workspaceId: context.workspaceId, exerciseId: 'exercise', code: 'code', prediction: null, idempotencyKey: 'same-key' })])
    expect(first).toEqual(second); expect(repository.attempts.size).toBe(1); expect(executions).toBe(5); expect(first).toMatchObject({ passedTests: 1, totalTests: 4, status: 'failed' }); expect(first.cases).toEqual([])
    expect(JSON.stringify(first)).not.toMatch(/hidden-|expectedOutput|5 7|\"visibility\":\"hidden\"/)
    expect(() => service.submit({ workspaceId: context.workspaceId, exerciseId: 'exercise', code: 'different', prediction: null, idempotencyKey: 'same-key' })).toThrow('Idempotency key')
  })

  it('compares predictions privately without executing submitted code', async () => {
    const repository = new MemoryRepository(); repository.exercise = { id: 'prediction', setId: 'set', workspaceId: context.workspaceId, topicId: context.topicId, position: 1, kind: 'PREDICT_OUTPUT', difficulty: 'introductory', title: 'Preveja', statement: 'Observe.', inputDescription: '', outputDescription: '', language: 'python', starterCode: '', predictionPrompt: 'Qual saída?', codeToObserve: 'print(42)', requiredForTopicCompletion: true, publicTests: [], hiddenTests: [], referenceSolution: null, expectedPrediction: '42', hint: 'Acompanhe a chamada.' }
    let executions = 0; const toolchains = { getStatuses: () => [{ language: 'python' as const, available: true, command: 'python', version: '3', detail: null }], execute: async () => { executions++; throw new Error('submit must not execute prediction code') } }
    const service = new ExerciseService(repository, new AIProviderManager(), toolchains as never, async () => ({ id: context.workspaceId, name: 'Python', objective: 'Loops', status: 'active', createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }), () => roadmap, () => 100, () => crypto.randomUUID())
    const failed = await service.submit({ workspaceId: context.workspaceId, exerciseId: 'prediction', code: '', prediction: '41', idempotencyKey: 'prediction-wrong' })
    const passed = await service.submit({ workspaceId: context.workspaceId, exerciseId: 'prediction', code: '', prediction: '42\n', idempotencyKey: 'prediction-right' })
    expect(failed).toMatchObject({ passed: false, passedTests: 0, totalTests: 0 })
    expect(passed).toMatchObject({ passed: true, passedTests: 0, totalTests: 0 })
    expect(failed.message).not.toContain('42'); expect(executions).toBe(0)
  })

  it('simplifies only public wording and keeps immutable assessment bytes untouched', async () => {
    const repository = new MemoryRepository(); repository.exercise = { id: 'exercise', setId: 'set', workspaceId: context.workspaceId, topicId: context.topicId, position: 1, assessmentIntentKey: 'intent', conceptKeys: ['concept'], kind: 'FIX_CODE', difficulty: 'challenge', title: 'Original', statement: 'Corrija o defeito.', inputDescription: 'Entrada original', outputDescription: 'Saída original', language: 'python', starterCode: 'print(0) # bug', predictionPrompt: null, codeToObserve: null, requiredForTopicCompletion: true, publicTests: [{ id: 'public-1', input: '1', expectedOutput: '1' }], hiddenTests: [{ id: 'hidden-1', input: '2', expectedOutput: '2' }], referenceSolution: 'print(input())', expectedPrediction: null, hint: 'privado' }
    const before = JSON.stringify(repository.exercise)
    const providers = new AIProviderManager(); providers.register({ id:'fake',name:'fake',testConnection:async()=>{},getCapabilities:()=>({streaming:false,usageInformation:false,supportedInput:['text']}),sendMessage:async(request)=>{ const payload=JSON.stringify(request); expect(payload).not.toMatch(/hidden-1|referenceSolution|privado|print\(input/); return {content:JSON.stringify({title:'Mais simples',statement:'Conserte o erro.',inputDescription:'Um valor',outputDescription:'O valor',predictionPrompt:null}),providerId:'fake',modelId:'fake-model'} }}); providers.select('fake')
    const service = new ExerciseService(repository,providers,{getStatuses:()=>[{language:'python',available:true}]} as never,async()=>null,()=>null)
    const adapted=await service.simplify({workspaceId:context.workspaceId,exerciseId:'exercise',requestId:'simplify-1'})
    expect(adapted).toMatchObject({revision:1,isActive:true,adapted:{title:'Mais simples'}}); expect(JSON.stringify(repository.exercise)).toBe(before)
  })

  it('builds dynamic escalating hint requests without private evaluator data', async () => {
    const repository = new MemoryRepository(); repository.exercise = { id: 'exercise', setId: 'set', workspaceId: context.workspaceId, topicId: context.topicId, position: 1, assessmentIntentKey: 'intent', conceptKeys: ['concept'], kind: 'PROGRAMMING_PROBLEM', difficulty: 'standard', title: 'Loop', statement: 'Repita.', inputDescription: '', outputDescription: '', language: 'python', starterCode: 'for', predictionPrompt: null, codeToObserve: null, requiredForTopicCompletion: true, publicTests: [{ id: 'public-1', input: '1', expectedOutput: '1' }], hiddenTests: [{ id: 'hidden-secret', input: '99', expectedOutput: '99' }], referenceSolution: 'SECRET_SOLUTION', expectedPrediction: null, hint: 'SECRET_HINT' }
    const requests:string[]=[]; const providers=new AIProviderManager(); providers.register({id:'fake',name:'fake',testConnection:async()=>{},getCapabilities:()=>({streaming:false,usageInformation:false,supportedInput:['text']}),sendMessage:async(request)=>{requests.push(JSON.stringify(request));return{content:`Dica ${requests.length}`,providerId:'fake',modelId:'fake-model'}}});providers.select('fake')
    const service=new ExerciseService(repository,providers,{getStatuses:()=>[{language:'python',available:true}]} as never,async()=>null,()=>null)
    const first=await service.requestHelp({workspaceId:context.workspaceId,exerciseId:'exercise',requestId:'hint-state-a',type:'hint_requested',currentSource:'for x in y:',currentPrediction:null}); const changed=await service.requestHelp({workspaceId:context.workspaceId,exerciseId:'exercise',requestId:'hint-state-b',type:'hint_requested',currentSource:'for x in values:',currentPrediction:null})
    expect(first.requestIdentity).not.toBe(changed.requestIdentity); expect(requests.join('')).not.toMatch(/hidden-secret|SECRET_SOLUTION|SECRET_HINT|"99"/); expect(requests[0]).toContain('currentSource')
  })

  it('coalesces retries for the same hint state and escalates only after persistence', async () => {
    const repository=new MemoryRepository(); repository.exercise={ id:'exercise',setId:'set',workspaceId:context.workspaceId,topicId:context.topicId,position:1,kind:'PROGRAMMING_PROBLEM',difficulty:'standard',title:'Loop',statement:'Repita.',inputDescription:'',outputDescription:'',language:'python',starterCode:'for',predictionPrompt:null,codeToObserve:null,requiredForTopicCompletion:true,publicTests:[{id:'public-1',input:'1',expectedOutput:'1'}],hiddenTests:[],referenceSolution:'solution',expectedPrediction:null,hint:'private' }
    let calls=0; const providers=new AIProviderManager(); providers.register({id:'fake',name:'fake',testConnection:async()=>{},getCapabilities:()=>({streaming:false,usageInformation:false,supportedInput:['text']}),sendMessage:async()=>{calls++;await new Promise((resolve)=>setTimeout(resolve,5));return{content:`Dica ${calls}`,providerId:'fake',modelId:'fake'}}});providers.select('fake')
    const service=new ExerciseService(repository,providers,{getStatuses:()=>[{language:'python',available:true}]} as never,async()=>null,()=>null)
    const input={workspaceId:context.workspaceId,exerciseId:'exercise',requestId:'same-hint-request',type:'hint_requested' as const,currentSource:'for x in xs:',currentPrediction:null}
    const [first,retry]=await Promise.all([service.requestHelp(input),service.requestHelp(input)]); expect(first).toEqual(retry); expect(calls).toBe(1); expect(first.helpLevel).toBe(1)
  })
})
