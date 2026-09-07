import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const createDeadlineInputSchema = z.object({ workspaceId: workspaceIdSchema, title: z.string().trim().min(1).max(160), dueAt: z.number().int().positive(), estimatedMinutes: z.number().int().min(1).max(100000), masteryPercent: z.number().int().min(0).max(100).nullable() }).strict()
export const addRoutineNoteInputSchema = z.object({ content: z.string().trim().min(1).max(2000) }).strict()
export const applyAcademicMessageInputSchema = z.object({ content: z.string().trim().min(1).max(4000) }).strict()
export type AcademicEventPhase = 'upcoming' | 'near' | 'today' | 'passed'
export interface WorkspacePriority { readonly workspaceId: string; readonly score: number; readonly level: 'on_track' | 'attention' | 'urgent'; readonly reason: string; readonly nextDeadline: string | null; readonly eventPhase?: AcademicEventPhase; readonly dueAt?: number }
export interface StudyScheduleItem { readonly workspaceId: string; readonly workspaceName: string; readonly title: string; readonly suggestedMinutes: number; readonly reason: string }
export interface AcademicEvent { readonly id: string; readonly workspaceId: string; readonly workspaceName: string; readonly type: 'exam' | 'assignment' | 'deadline'; readonly title: string; readonly dueAt: number; readonly phase: AcademicEventPhase }
export interface AcademicAvailability { readonly weekday: number; readonly minutes: number }
export interface AcademicWorkspaceContext { readonly workspaceId: string; readonly workspaceName: string; readonly difficulty: string | null; readonly completedTopics: number; readonly totalTopics: number }
export interface AcademicOverview { readonly events: AcademicEvent[]; readonly availability: AcademicAvailability[]; readonly workspaces: AcademicWorkspaceContext[]; readonly routine: string[] }
export interface AcademicMutationResult { readonly changed: boolean; readonly summary: string; readonly workspaceIds: string[]; readonly needsRefinement: string | null; readonly ambiguousWorkspaces?: Array<{ id: string; name: string }>; readonly pendingEvent?: { type: 'exam' | 'assignment' | 'deadline'; subject: string; dueAt: number } }
export interface HomeOrganizerResult { readonly outcome: 'applied' | 'needs_decision' | 'informational' | 'needs_information' | 'failed'; readonly operations: string[]; readonly actions: import('./planner-action-contract').PlannerAction[]; readonly affectedWorkspaceIds: string[]; readonly message: string }
export interface PlanningApi { listPriorities(): Promise<WorkspacePriority[]>; createDeadline(input: z.infer<typeof createDeadlineInputSchema>): Promise<void>; addRoutineNote(content: string): Promise<void>; listRoutineNotes(): Promise<string[]>; getSchedule(): Promise<StudyScheduleItem[]>; applyAcademicMessage(content: string): Promise<AcademicMutationResult>; getAcademicOverview(): Promise<AcademicOverview> }
