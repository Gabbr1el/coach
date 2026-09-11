import { createHash } from 'node:crypto'
import type { Roadmap } from '../../shared/contracts/roadmap-contract'
import type { ContentJob, ContentUnitKind } from '../../shared/contracts/workspace-content-contract'
import type { WorkspaceContentRepository } from './workspace-content-repository'

export type PedagogicalPrefetchTrigger =
  | { type: 'topic_selected' | 'topic_opened'; workspaceId: string; topicId: string }
  | { type: 'checkpoint_interacted' | 'required_exercise_near_completion'; workspaceId: string; topicId: string }
  | { type: 'topic_unlocked'; workspaceId: string; topicId: string }

export interface PedagogicalPrefetchSchedulerOptions {
  readonly repository: WorkspaceContentRepository
  readonly getRoadmap: (workspaceId: string) => Roadmap | null
  readonly onJobsChanged?: () => void
  readonly now?: () => number
}

const versions: Record<ContentUnitKind, string> = {
  material_extract: 'material-v1', material_analyze: 'material-analysis-v1', roadmap_generate: 'roadmap-v1', lesson_generate: 'lesson-v1', exercise_generate: 'exercise-v1', plan_recalculate: 'plan-v1',
}

function key(workspaceId: string, revision: number, kind: ContentUnitKind, unitKey: string, inputHash: string): string {
  return createHash('sha256').update([workspaceId, revision, kind, unitKey, inputHash, versions[kind]].join('|')).digest('hex')
}

export class PedagogicalPrefetchScheduler {
  private readonly now: () => number
  constructor(private readonly options: PedagogicalPrefetchSchedulerOptions) { this.now = options.now ?? Date.now }

  schedule(trigger: PedagogicalPrefetchTrigger): ContentJob[] {
    const revision = this.options.repository.getRevision(trigger.workspaceId)
    const roadmap = this.options.getRoadmap(trigger.workspaceId)
    if (!revision || !roadmap) return []
    const topics = roadmap.modules.flatMap((module) => module.topics.map((topic) => ({ moduleId: module.id, topicId: `${module.id}:${topic}` })))
    const index = topics.findIndex((topic) => topic.topicId === trigger.topicId)
    if (index < 0) return []
    const current = topics[index]!
    const next = topics[index + 1]
    const specs: Array<{ kind: ContentUnitKind; unitKey: string; priority: number; dependencies?: string[] }> = []
    if (trigger.type === 'topic_selected' || trigger.type === 'topic_opened' || trigger.type === 'topic_unlocked') {
      specs.push({ kind: 'lesson_generate', unitKey: current.topicId, priority: 1_000 })
      specs.push({ kind: 'exercise_generate', unitKey: current.topicId, priority: 1_000, dependencies: [key(trigger.workspaceId, revision.revision, 'lesson_generate', current.topicId, revision.inputHash)] })
    }
    if (trigger.type === 'checkpoint_interacted' || trigger.type === 'required_exercise_near_completion') {
      specs.push({ kind: 'exercise_generate', unitKey: current.topicId, priority: 700, dependencies: [key(trigger.workspaceId, revision.revision, 'lesson_generate', current.topicId, revision.inputHash)] })
    }
    if (next) specs.push({ kind: 'lesson_generate', unitKey: next.topicId, priority: trigger.type === 'topic_unlocked' ? 700 : 500 })
    const jobs = specs.map((spec) => this.options.repository.enqueue({ workspaceId: trigger.workspaceId, revision: revision.revision, kind: spec.kind, unitKey: spec.unitKey, priority: spec.priority, inputHash: revision.inputHash, generatorContractVersion: versions[spec.kind], dependencyKeys: spec.dependencies }, this.now()))
    if (jobs.length) this.options.onJobsChanged?.()
    return jobs
  }
}
