import { describe, expect, it } from 'vitest'
import { ExerciseService, type ExerciseRepository, type PrivateExercise } from '../../src/application/exercises/exercise-service'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import type { ExerciseExecution, ExerciseSet } from '../../src/shared/contracts/exercise-contract'

class MemoryRepository implements ExerciseRepository {
  set: ExerciseSet | null = null
  exercise: PrivateExercise | null = null
  attempts = new Map<string, ExerciseExecution>()
  findSet(): ExerciseSet | null { return this.set }
  findPrivateExercise(): PrivateExercise | null { return this.exercise }
  markGenerating(input: { id: string; workspaceId: string; roadmapId: string; moduleId: string; topicId: string; lessonId: string; now: number }): void { this.set = { ...input, status: 'generating', retryAfter: null, lastErrorCode: null, exercises: [], progress: [], updatedAt: input.now } }
  markGenerationFailure(_workspaceId: string, _topicId: string, status: 'waiting_for_provider' | 'failed_retryable', code: string, retryAfter: number, now: number): ExerciseSet { this.set = { ...this.set!, status, lastErrorCode: code, retryAfter, updatedAt: now }; return this.set }
  saveGenerated(input: { setId: string; workspaceId: string; topicId: string; providerId: string; modelId: string; exercises: PrivateExercise[]; now: number }): ExerciseSet { this.exercise = input.exercises[0]!; this.set = { ...this.set!, status: 'ready', retryAfter: null, lastErrorCode: null, exercises: input.exercises.map(({ hiddenTests: _h, referenceSolution: _r, expectedPrediction: _p, hint: _hint, setId: _s, workspaceId: _w, topicId: _t, ...item }) => item), progress: [], updatedAt: input.now }; return this.set }
  saveRun(): void {}
  findAttempt(_workspaceId: string, key: string, exerciseId: string, sourceRevision: string): ExerciseExecution | null { const result = this.attempts.get(key) ?? null; if (result && (result.exerciseId !== exerciseId || sourceRevision !== '5694d08a2e53ffca')) throw new Error('Idempotency key was already used for a different submission'); return result }
  saveSubmission(input: { idempotencyKey: string; execution: ExerciseExecution }): ExerciseExecution { this.attempts.set(input.idempotencyKey, input.execution); return input.execution }
  requestHelp(): { helpCount: number; hint: string } { return { helpCount: 1, hint: this.exercise!.hint } }
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
})
