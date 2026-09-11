import type { EnqueueContentJobInput, WorkspaceContentRepository } from './workspace-content-repository'

export class WorkspaceContentService {
  constructor(private readonly repository: WorkspaceContentRepository, private readonly now = Date.now) {}
  enqueue(input: EnqueueContentJobInput) { return this.repository.enqueue(input, this.now()) }
  reconcileRestart() { return this.repository.reconcile(this.now()) }
  getRevision(workspaceId: string) { return this.repository.getRevision(workspaceId) }
  evaluateReadiness(workspaceId: string, expectedRevision: number, todayDateKey: string) { return this.repository.evaluateReadiness({ workspaceId, expectedRevision, todayDateKey, now: this.now() }) }
}
