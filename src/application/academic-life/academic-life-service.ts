import type { AcademicLifeItem, AcademicLifeMutationInput, AcademicLifeProjection } from '../../shared/contracts/academic-life-contract'
import { academicLifeMutationInputSchema } from '../../shared/contracts/academic-life-contract'

export interface AcademicLifeRepository {
  save(input: AcademicLifeMutationInput & { id: string }, now: number): AcademicLifeItem
  transition(id: string, status: 'resolved' | 'archived', now: number): AcademicLifeItem
  projection(now: number, historyLimit: number): AcademicLifeProjection
  activeForContext(now: number, limit: number, workspaceId?: string): AcademicLifeItem[]
}

export class AcademicLifeService {
  constructor(private readonly repository: AcademicLifeRepository, private readonly now = Date.now, private readonly createId = () => crypto.randomUUID()) {}
  getProjection(historyLimit = 100): AcademicLifeProjection { return this.repository.projection(this.now(), Math.min(200, Math.max(1, historyLimit))) }
  save(input: AcademicLifeMutationInput): AcademicLifeItem {
    const parsed = academicLifeMutationInputSchema.parse(input)
    return this.repository.save({ ...parsed, id: this.createId() }, this.now())
  }
  transition(id: string, status: 'resolved' | 'archived'): AcademicLifeItem { return this.repository.transition(id, status, this.now()) }
  activeForContext(limit = 20, workspaceId?: string): AcademicLifeItem[] { return this.repository.activeForContext(this.now(), Math.min(30, Math.max(1, limit)), workspaceId) }
}
