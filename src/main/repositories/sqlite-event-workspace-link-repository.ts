import type { EventWorkspaceLinkRepository } from '../../application/academic-life/event-workspace-link-service'
import type { AcademicLifeItem } from '../../shared/contracts/academic-life-contract'
import type { Workspace } from '../../shared/contracts/workspace-contract'
import type { CoachDatabase } from '../database/connection'
import type { AcademicLifeService } from '../../application/academic-life/academic-life-service'
import type { AcademicSubjectContextService } from '../../application/workspaces/academic-subject-context'

export class SqliteEventWorkspaceLinkRepository implements EventWorkspaceLinkRepository {
  constructor(private readonly database: CoachDatabase, private readonly academicLife: AcademicLifeService, private readonly academicContext: AcademicSubjectContextService, private readonly findOwnedWorkspace: (id: string) => Promise<Workspace | null>) {}
  findEvent(id: string): AcademicLifeItem | null { return this.academicLife.find(id) }
  findReplacement(id: string): AcademicLifeItem | null { return this.academicLife.find(id) }
  findWorkspace(id: string): Promise<Workspace | null> { return this.findOwnedWorkspace(id) }
  replaceAndConfirmAlias(input: { event: AcademicLifeItem; workspaceId: string | null; subject?: string }): AcademicLifeItem {
    return this.database.sqlite.transaction(() => {
      if (input.workspaceId !== null && input.subject) {
        const canonical = this.academicContext.get(input.subject) ?? this.academicContext.record({ subject: input.subject, declaredLevel: null, declaredKnowledge: [], declaredDifficulties: [], goals: [], sourceEvidence: [`Vínculo confirmado com Workspace ${input.workspaceId}`] })
        this.database.sqlite.prepare("INSERT INTO workspace_academic_contexts (workspace_id,subject,relation) VALUES (?,?,'user_selected') ON CONFLICT(workspace_id,subject) DO UPDATE SET relation=CASE WHEN workspace_academic_contexts.relation='primary' THEN 'primary' ELSE 'user_selected' END").run(input.workspaceId, canonical.subject)
      }
      return this.academicLife.save({ kind: input.event.kind, title: input.event.title, details: input.event.details, workspaceId: input.workspaceId, startsAt: input.event.startsAt, endsAt: input.event.endsAt, expiresAt: input.event.expiresAt, timezone: input.event.timezone, weekday: input.event.weekday, minutes: input.event.minutes, shareWithAi: input.event.shareWithAi, provenance: input.event.provenance, replacesId: input.event.id })
    })()
  }
}
