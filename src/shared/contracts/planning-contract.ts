import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const createDeadlineInputSchema = z.object({ workspaceId: workspaceIdSchema, title: z.string().trim().min(1).max(160), dueAt: z.number().int().positive(), estimatedMinutes: z.number().int().min(1).max(100000), masteryPercent: z.number().int().min(0).max(100) }).strict()
export const addRoutineNoteInputSchema = z.object({ content: z.string().trim().min(1).max(2000) }).strict()
export type AcademicEventPhase = 'upcoming' | 'near' | 'today' | 'passed'
export interface WorkspacePriority { readonly workspaceId: string; readonly score: number; readonly level: 'on_track' | 'attention' | 'urgent'; readonly reason: string; readonly nextDeadline: string | null; readonly eventPhase?: AcademicEventPhase; readonly dueAt?: number }
export interface StudyScheduleItem { readonly workspaceId: string; readonly workspaceName: string; readonly title: string; readonly suggestedMinutes: number; readonly reason: string }
export interface PlanningApi { listPriorities(): Promise<WorkspacePriority[]>; createDeadline(input: z.infer<typeof createDeadlineInputSchema>): Promise<void>; addRoutineNote(content: string): Promise<void>; listRoutineNotes(): Promise<string[]>; getSchedule(): Promise<StudyScheduleItem[]> }
