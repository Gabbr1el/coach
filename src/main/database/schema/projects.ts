import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const workspaceProjects = sqliteTable('workspace_projects', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  language: text('language', { enum: ['python', 'c', 'java'] }).notNull(),
  entryFilePath: text('entry_file_path').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('workspace_projects_name_check', sql`length(trim(${table.name})) between 1 and 120`),
  check('workspace_projects_language_check', sql`${table.language} in ('python', 'c', 'java')`),
  uniqueIndex('workspace_projects_one_per_workspace_idx').on(table.workspaceId),
])

export const projectFiles = sqliteTable('project_files', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => workspaceProjects.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  content: text('content').notNull().default(''),
  revision: integer('revision').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('project_files_path_check', sql`length(${table.path}) between 1 and 240`),
  check('project_files_revision_check', sql`${table.revision} >= 0`),
  uniqueIndex('project_files_project_path_idx').on(table.projectId, table.path),
  index('project_files_project_updated_idx').on(table.projectId, table.updatedAt),
])

export const projectUiStates = sqliteTable('project_ui_states', {
  projectId: text('project_id').primaryKey().references(() => workspaceProjects.id, { onDelete: 'cascade' }),
  activeFileId: text('active_file_id').notNull().references(() => projectFiles.id, { onDelete: 'restrict' }),
  openFileIdsJson: text('open_file_ids_json').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
})

export const projectBuilds = sqliteTable('project_builds', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => workspaceProjects.id, { onDelete: 'cascade' }),
  command: text('command').notNull(),
  exitCode: integer('exit_code'),
  timedOut: integer('timed_out', { mode: 'boolean' }).notNull().default(false),
  durationMs: integer('duration_ms').notNull(),
  stdout: text('stdout').notNull().default(''),
  stderr: text('stderr').notNull().default(''),
  diagnosticsJson: text('diagnostics_json').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('project_builds_project_created_idx').on(table.projectId, table.createdAt)])
