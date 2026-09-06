import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const projectLanguageSchema = z.enum(['python', 'c', 'java'])
export type ProjectLanguage = z.infer<typeof projectLanguageSchema>

export const projectFilePathSchema = z.string().trim().min(1).max(240).refine((path) => !path.startsWith('/') && !path.includes('\\') && !path.split('/').some((part) => part === '' || part === '.' || part === '..'), 'Invalid project-relative path')
export const createProjectInputSchema = z.object({ workspaceId: workspaceIdSchema, name: z.string().trim().min(1).max(120), language: projectLanguageSchema }).strict()
export const workspaceProjectInputSchema = z.object({ workspaceId: workspaceIdSchema }).strict()
export const projectIdSchema = z.uuid()
export const createProjectFileInputSchema = z.object({ projectId: projectIdSchema, path: projectFilePathSchema, content: z.string().max(200_000).default('') }).strict()
export const saveProjectFileInputSchema = z.object({ projectId: projectIdSchema, fileId: z.uuid(), content: z.string().max(200_000), expectedRevision: z.number().int().nonnegative() }).strict()
export const renameProjectFileInputSchema = z.object({ projectId: projectIdSchema, fileId: z.uuid(), path: projectFilePathSchema }).strict()
export const deleteProjectFileInputSchema = z.object({ projectId: projectIdSchema, fileId: z.uuid() }).strict()
export const openProjectFileInputSchema = z.object({ projectId: projectIdSchema, fileId: z.uuid() }).strict()

export interface ProjectFile { readonly id: string; readonly path: string; readonly content: string; readonly revision: number; readonly updatedAt: number }
export interface WorkspaceProject { readonly id: string; readonly workspaceId: string; readonly name: string; readonly language: ProjectLanguage; readonly entryFilePath: string; readonly files: ProjectFile[]; readonly activeFileId: string; readonly openFileIds: string[]; readonly updatedAt: number }

export interface ProjectApi {
  get(workspaceId: string): Promise<WorkspaceProject | null>
  create(input: z.infer<typeof createProjectInputSchema>): Promise<WorkspaceProject>
  createFile(input: z.infer<typeof createProjectFileInputSchema>): Promise<WorkspaceProject>
  saveFile(input: z.infer<typeof saveProjectFileInputSchema>): Promise<WorkspaceProject>
  renameFile(input: z.infer<typeof renameProjectFileInputSchema>): Promise<WorkspaceProject>
  deleteFile(input: z.infer<typeof deleteProjectFileInputSchema>): Promise<WorkspaceProject>
  openFile(input: z.infer<typeof openProjectFileInputSchema>): Promise<WorkspaceProject>
}
