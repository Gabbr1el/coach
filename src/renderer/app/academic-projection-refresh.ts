import type { AcademicLifeProjection } from '../../shared/contracts/academic-life-contract'
import type { AcademicOverview, StudyScheduleItem, WeeklyPlan, WorkspacePriority } from '../../shared/contracts/planning-contract'
import type { GlobalReportOverview } from '../../shared/contracts/report-contract'
import type { WorkspaceSummary } from '../../shared/contracts/workspace-contract'

export interface AcademicProjectionSnapshot {
  readonly workspaces: WorkspaceSummary[]
  readonly priorities: WorkspacePriority[]
  readonly schedule: StudyScheduleItem[]
  readonly weeklyPlan: WeeklyPlan
  readonly academicOverview: AcademicOverview
  readonly academicLife: AcademicLifeProjection
  readonly reports: GlobalReportOverview
}

export interface AcademicProjectionSource {
  replanWeek(): Promise<WeeklyPlan>
  listWorkspaces(): Promise<WorkspaceSummary[]>
  listPriorities(): Promise<WorkspacePriority[]>
  getSchedule(): Promise<StudyScheduleItem[]>
  getAcademicOverview(): Promise<AcademicOverview>
  getAcademicLife(): Promise<AcademicLifeProjection>
  getReports(): Promise<GlobalReportOverview>
}

export async function refreshAcademicProjections(source: AcademicProjectionSource): Promise<AcademicProjectionSnapshot> {
  const weeklyPlan = await source.replanWeek()
  const [workspaces, priorities, schedule, academicOverview, academicLife, reports] = await Promise.all([
    source.listWorkspaces(), source.listPriorities(), source.getSchedule(), source.getAcademicOverview(), source.getAcademicLife(), source.getReports(),
  ])
  return { workspaces, priorities, schedule, weeklyPlan, academicOverview, academicLife, reports }
}
