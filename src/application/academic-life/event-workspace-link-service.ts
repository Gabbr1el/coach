import type { AcademicLifeItem } from '../../shared/contracts/academic-life-contract'
import type { Workspace } from '../../shared/contracts/workspace-contract'

export interface EventWorkspaceLinkRepository {
  findEvent(id: string): AcademicLifeItem | null
  findReplacement(id: string): AcademicLifeItem | null
  findWorkspace(id: string): Promise<Workspace | null>
  replaceAndConfirmAlias(input: { event: AcademicLifeItem; workspaceId: string | null; subject?: string }): AcademicLifeItem
}

export class EventWorkspaceLinkService {
  constructor(private readonly repository: EventWorkspaceLinkRepository) {}

  async link(eventId: string, workspaceId: string | null, subject?: string): Promise<AcademicLifeItem> {
    const event = this.repository.findEvent(eventId)
    if (!event) throw new Error('Academic event not found')
    if (event.replacedById) {
      const replacement = this.repository.findReplacement(event.replacedById)
      if (replacement?.status === 'active' && replacement.workspaceId === workspaceId) return replacement
      throw new Error('Academic event is no longer active')
    }
    if (event.status !== 'active' || !['event', 'commitment'].includes(event.kind)) throw new Error('Academic event is no longer active')
    if (workspaceId !== null) {
      const workspace = await this.repository.findWorkspace(workspaceId)
      if (!workspace || workspace.status !== 'active') throw new Error('Workspace not found or archived')
    }
    return this.repository.replaceAndConfirmAlias({ event, workspaceId, subject })
  }
}
