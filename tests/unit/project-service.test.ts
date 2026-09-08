import { describe, expect, it } from 'vitest'
import { ProjectService, type ProjectRepository } from '../../src/application/projects/project-service'
import type { WorkspaceProject } from '../../src/shared/contracts/project-contract'

class MemoryProjectRepository implements ProjectRepository {
  project: WorkspaceProject | null = null
  findByWorkspace(): WorkspaceProject | null { return this.project }
  findById(): WorkspaceProject | null { return this.project }
  create(input: WorkspaceProject): WorkspaceProject { this.project = input; return input }
  createFile(): WorkspaceProject { return this.project! }
  saveFile(): WorkspaceProject { return this.project! }
  renameFile(): WorkspaceProject { return this.project! }
  deleteFile(): WorkspaceProject { return this.project! }
  openFile(): WorkspaceProject { return this.project! }
}

describe('ProjectService', () => {
  it.each([
    ['python', 'src/main.py', ['src/main.py'], 'print("Coach")'],
    ['c', 'src/main.c', ['src/main.c'], '#include <stdio.h>'],
    ['java', 'src/Main.java', ['src/Main.java', 'src/Pessoa.java'], 'public class Main'],
  ] as const)('creates a semantically correct %s starter project', async (language, entryFilePath, paths, sourceMarker) => {
    const repository = new MemoryProjectRepository()
    let id = 0
    const service = new ProjectService(repository, async () => true, () => 10, () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`)
    const project = await service.create('00000000-0000-4000-8000-000000000001', 'Prática', language)
    expect(project.entryFilePath).toBe(entryFilePath)
    expect(project.files.map((file) => file.path)).toEqual(paths)
    expect(project.files[0]?.content).toContain(sourceMarker)
    expect(project.files.some((file) => file.content.includes('LinkedList'))).toBe(false)
  })
})
