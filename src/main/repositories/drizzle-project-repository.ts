import type { ProjectRepository } from '../../application/projects/project-service'
import type { ProjectFile, WorkspaceProject } from '../../shared/contracts/project-contract'
import type { CoachDatabase } from '../database/connection'

function parseIds(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [] } catch { return [] }
}

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly database: CoachDatabase) {}

  findByWorkspace(workspaceId: string): WorkspaceProject | null {
    const row = this.database.sqlite.prepare('SELECT id FROM workspace_projects WHERE workspace_id = ?').get(workspaceId) as { id: string } | undefined
    return row ? this.findById(row.id) : null
  }

  findById(projectId: string): WorkspaceProject | null {
    const row = this.database.sqlite.prepare(`SELECT p.id, p.workspace_id AS workspaceId, p.name, p.language, p.entry_file_path AS entryFilePath, p.updated_at AS updatedAt, u.active_file_id AS activeFileId, u.open_file_ids_json AS openFileIdsJson FROM workspace_projects p JOIN project_ui_states u ON u.project_id = p.id WHERE p.id = ?`).get(projectId) as (Omit<WorkspaceProject, 'files' | 'openFileIds'> & { openFileIdsJson: string }) | undefined
    if (!row) return null
    const files = this.database.sqlite.prepare('SELECT id, path, content, revision, updated_at AS updatedAt FROM project_files WHERE project_id = ? ORDER BY path').all(projectId) as ProjectFile[]
    return { ...row, files, openFileIds: parseIds(row.openFileIdsJson) }
  }

  create(input: WorkspaceProject): WorkspaceProject {
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('INSERT INTO workspace_projects (id, workspace_id, name, language, entry_file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(input.id, input.workspaceId, input.name, input.language, input.entryFilePath, input.updatedAt, input.updatedAt)
      const insertFile = this.database.sqlite.prepare('INSERT INTO project_files (id, project_id, path, content, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const file of input.files) insertFile.run(file.id, input.id, file.path, file.content, file.revision, file.updatedAt, file.updatedAt)
      this.database.sqlite.prepare('INSERT INTO project_ui_states (project_id, active_file_id, open_file_ids_json, updated_at) VALUES (?, ?, ?, ?)').run(input.id, input.activeFileId, JSON.stringify(input.openFileIds), input.updatedAt)
    })()
    return this.require(input.id)
  }

  createFile(projectId: string, file: ProjectFile, now: number): WorkspaceProject {
    this.require(projectId)
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('INSERT INTO project_files (id, project_id, path, content, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(file.id, projectId, file.path, file.content, file.revision, now, now)
      const current = this.require(projectId)
      this.database.sqlite.prepare('UPDATE project_ui_states SET active_file_id = ?, open_file_ids_json = ?, updated_at = ? WHERE project_id = ?').run(file.id, JSON.stringify([...new Set([...current.openFileIds, file.id])]), now, projectId)
      this.touch(projectId, now)
    })()
    return this.require(projectId)
  }

  saveFile(projectId: string, fileId: string, content: string, expectedRevision: number, now: number): WorkspaceProject {
    const result = this.database.sqlite.prepare('UPDATE project_files SET content = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND project_id = ? AND revision = ?').run(content, now, fileId, projectId, expectedRevision)
    if (result.changes !== 1) throw new Error('Project file changed or was not found')
    this.touch(projectId, now)
    return this.require(projectId)
  }

  renameFile(projectId: string, fileId: string, path: string, now: number): WorkspaceProject {
    const result = this.database.sqlite.prepare('UPDATE project_files SET path = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND project_id = ?').run(path, now, fileId, projectId)
    if (result.changes !== 1) throw new Error('Project file not found')
    this.touch(projectId, now)
    return this.require(projectId)
  }

  deleteFile(projectId: string, fileId: string, now: number): WorkspaceProject {
    const project = this.require(projectId)
    if (project.files.length <= 1 || project.activeFileId === fileId) throw new Error('Open another file before deleting this file')
    const result = this.database.sqlite.prepare('DELETE FROM project_files WHERE id = ? AND project_id = ?').run(fileId, projectId)
    if (result.changes !== 1) throw new Error('Project file not found')
    this.database.sqlite.prepare('UPDATE project_ui_states SET open_file_ids_json = ?, updated_at = ? WHERE project_id = ?').run(JSON.stringify(project.openFileIds.filter((id) => id !== fileId)), now, projectId)
    this.touch(projectId, now)
    return this.require(projectId)
  }

  openFile(projectId: string, fileId: string, now: number): WorkspaceProject {
    const project = this.require(projectId)
    if (!project.files.some((file) => file.id === fileId)) throw new Error('Project file not found')
    this.database.sqlite.prepare('UPDATE project_ui_states SET active_file_id = ?, open_file_ids_json = ?, updated_at = ? WHERE project_id = ?').run(fileId, JSON.stringify([...new Set([...project.openFileIds, fileId])]), now, projectId)
    return this.require(projectId)
  }

  private touch(projectId: string, now: number): void { this.database.sqlite.prepare('UPDATE workspace_projects SET updated_at = ? WHERE id = ?').run(now, projectId) }
  private require(projectId: string): WorkspaceProject { const project = this.findById(projectId); if (!project) throw new Error('Project not found'); return project }
}
