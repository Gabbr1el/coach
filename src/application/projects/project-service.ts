import type { ProjectLanguage, WorkspaceProject } from '../../shared/contracts/project-contract'

export interface ProjectRepository {
  findByWorkspace(workspaceId: string): WorkspaceProject | null
  findById(projectId: string): WorkspaceProject | null
  create(input: WorkspaceProject): WorkspaceProject
  createFile(projectId: string, file: WorkspaceProject['files'][number], now: number): WorkspaceProject
  saveFile(projectId: string, fileId: string, content: string, expectedRevision: number, now: number): WorkspaceProject
  renameFile(projectId: string, fileId: string, path: string, now: number): WorkspaceProject
  deleteFile(projectId: string, fileId: string, now: number): WorkspaceProject
  openFile(projectId: string, fileId: string, now: number): WorkspaceProject
}

const STARTERS: Record<ProjectLanguage, { entry: string; files: Array<[string, string]> }> = {
  python: { entry: 'src/main.py', files: [['src/main.py', 'print("Coach")\n']] },
  c: { entry: 'src/main.c', files: [['src/main.c', '#include <stdio.h>\n\nint main(void) {\n    puts("Coach");\n    return 0;\n}\n']] },
  java: { entry: 'src/Main.java', files: [['src/Main.java', 'public class Main {\n    public static void main(String[] args) {\n        Pessoa pessoa = new Pessoa("Estudante");\n        System.out.println(pessoa.apresentar());\n    }\n}\n'], ['src/Pessoa.java', 'public class Pessoa {\n    private final String nome;\n\n    public Pessoa(String nome) {\n        this.nome = nome;\n    }\n\n    public String apresentar() {\n        return "Olá, " + nome;\n    }\n}\n']] },
}

export class ProjectService {
  constructor(private readonly repository: ProjectRepository, private readonly workspaceExists: (id: string) => Promise<boolean>, private readonly now = Date.now, private readonly createId = () => crypto.randomUUID()) {}

  async get(workspaceId: string): Promise<WorkspaceProject | null> {
    if (!await this.workspaceExists(workspaceId)) throw new Error('Workspace not found')
    return this.repository.findByWorkspace(workspaceId)
  }

  async create(workspaceId: string, name: string, language: ProjectLanguage): Promise<WorkspaceProject> {
    if (!await this.workspaceExists(workspaceId)) throw new Error('Workspace not found')
    const existing = this.repository.findByWorkspace(workspaceId)
    if (existing) return existing
    const now = this.now()
    const starter = STARTERS[language]
    const files = starter.files.map(([path, content]) => ({ id: this.createId(), path, content, revision: 0, updatedAt: now }))
    return this.repository.create({ id: this.createId(), workspaceId, name, language, entryFilePath: starter.entry, files, activeFileId: files[0]!.id, openFileIds: [files[0]!.id], updatedAt: now })
  }

  createFile(projectId: string, path: string, content: string): WorkspaceProject {
    return this.repository.createFile(projectId, { id: this.createId(), path, content, revision: 0, updatedAt: this.now() }, this.now())
  }

  saveFile(projectId: string, fileId: string, content: string, expectedRevision: number): WorkspaceProject { return this.repository.saveFile(projectId, fileId, content, expectedRevision, this.now()) }
  renameFile(projectId: string, fileId: string, path: string): WorkspaceProject { return this.repository.renameFile(projectId, fileId, path, this.now()) }
  deleteFile(projectId: string, fileId: string): WorkspaceProject { return this.repository.deleteFile(projectId, fileId, this.now()) }
  openFile(projectId: string, fileId: string): WorkspaceProject { return this.repository.openFile(projectId, fileId, this.now()) }
}
