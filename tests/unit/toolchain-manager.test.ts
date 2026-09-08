import { describe, expect, it } from 'vitest'
import { ToolchainManager } from '../../src/main/code-execution/toolchain-manager'
import type { WorkspaceProject } from '../../src/shared/contracts/project-contract'

function project(language: 'python' | 'c' | 'java', files: Array<[string, string]>, entryFilePath: string): WorkspaceProject {
  return { id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), name: 'Teste', language, entryFilePath, files: files.map(([path, content]) => ({ id: crypto.randomUUID(), path, content, revision: 0, updatedAt: 1 })), activeFileId: '', openFileIds: [], updatedAt: 1 }
}

describe('ToolchainManager', () => {
  it('runs Python and returns structured runtime diagnostics', async () => {
    const manager = new ToolchainManager()
    const success = await manager.execute(project('python', [['src/app.py', 'print("python-ok")']], 'src/app.py'))
    expect(success).toMatchObject({ exitCode: 0, stdout: 'python-ok\n', phase: 'run', diagnostics: [] })
    const failure = await manager.execute(project('python', [['src/app.py', 'print(missing)']], 'src/app.py'))
    expect(failure.diagnostics?.[0]).toMatchObject({ filePath: 'src/app.py', line: 1, severity: 'error', code: 'NameError' })
  }, 15_000)

  it('compiles and runs a multi-file C project', async () => {
    const result = await new ToolchainManager().execute(project('c', [['src/main.c', '#include "soma.h"\n#include <stdio.h>\nint main(void){printf("%d\\n", soma(2,3));}'], ['src/soma.h', 'int soma(int a,int b);'], ['src/soma.c', '#include "soma.h"\nint soma(int a,int b){return a+b;}']], 'src/main.c'))
    expect(result).toMatchObject({ exitCode: 0, stdout: '5\n', phase: 'run' })
  }, 15_000)

  it('returns structured C diagnostics', async () => {
    const result = await new ToolchainManager().execute(project('c', [['src/main.c', 'int main(void) { return missing; }']], 'src/main.c'))
    expect(result).toMatchObject({ phase: 'compile' })
    expect(result.diagnostics?.[0]).toMatchObject({ filePath: 'src/main.c', line: 1, severity: 'error' })
  }, 15_000)

  it('compiles Java and returns structured Java diagnostics', async () => {
    const manager = new ToolchainManager()
    const success = await manager.execute(project('java', [['src/Main.java', 'public class Main { public static void main(String[] args) { System.out.println("java-ok"); } }']], 'src/Main.java'))
    expect(success).toMatchObject({ exitCode: 0, stdout: 'java-ok\n', phase: 'run' })
    const failure = await manager.execute(project('java', [['src/Main.java', 'public class Main { public static void main(String[] args) { inexistente(); } }']], 'src/Main.java'))
    expect(failure.phase).toBe('compile')
    expect(failure.diagnostics?.[0]).toMatchObject({ filePath: 'src/Main.java', severity: 'error' })
  }, 20_000)
})
