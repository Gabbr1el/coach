import { describe, expect, it } from 'vitest'
import { ToolchainManager } from '../../src/main/code-execution/toolchain-manager'
import type { WorkspaceProject } from '../../src/shared/contracts/project-contract'
import { validateInteractiveExecution } from '../../src/main/ipc/code-execution-handlers'
import { interactiveSourceRevision } from '../../src/shared/interactive-source-revision'
import { parseInteractiveValidation } from '../../src/shared/contracts/code-execution-contract'

function project(language: 'python' | 'c' | 'java', files: Array<[string, string]>, entryFilePath: string): WorkspaceProject {
  return { id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), name: 'Teste', language, entryFilePath, files: files.map(([path, content]) => ({ id: crypto.randomUUID(), path, content, revision: 0, updatedAt: 1 })), activeFileId: '', openFileIds: [], updatedAt: 1 }
}

describe('ToolchainManager', () => {
  it('requires real output validation instead of treating exit code zero as correctness', () => {
    const block = { id: 'block', type: 'interactiveCode' as const, title: 'Validar', interactionType: 'EDIT_AND_RUN' as const, language: 'python' as const, instruction: 'Execute', initialCode: 'print(2)', predictionPrompt: null, evidenceMode: 'validated' as const, requiredForTopicCompletion: false, expectedOutput: '2' }
    const execution = { command: 'python3 main.py', stdout: '3\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 1, errorSignature: null }
    expect(validateInteractiveExecution(block, execution, 'revision-00000001', null, 10)).toMatchObject({ status: 'failed' })
    expect(validateInteractiveExecution(block, { ...execution, stdout: '2\n' }, 'revision-00000002', null, 11)).toMatchObject({ status: 'passed' })
    expect(validateInteractiveExecution({ ...block, evidenceMode: 'observation' }, { ...execution, stdout: '2\n' }, 'revision-00000003', null, 12)).toMatchObject({ status: 'not_applicable' })
  })

  it('records deterministic prediction correctness and source revision', () => {
    const block = { id: 'predict', type: 'interactiveCode' as const, title: 'Prever', interactionType: 'PREDICT_AND_RUN' as const, language: 'python' as const, instruction: 'Preveja', initialCode: 'print(7)', predictionPrompt: 'Saída?', evidenceMode: 'observation' as const, requiredForTopicCompletion: false, expectedOutput: null }
    const execution = { command: 'python3 main.py', stdout: '7\r\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 1, errorSignature: null }
    const revision = interactiveSourceRevision(block.initialCode, '7')
    expect(validateInteractiveExecution(block, execution, revision, '7', 10)).toMatchObject({ sourceRevision: revision, actualOutput: '7', predictionCorrect: true })
    expect(validateInteractiveExecution(block, execution, interactiveSourceRevision(block.initialCode, '8'), '8', 11)).toMatchObject({ predictionCorrect: false })
  })

  it('treats validation records from before source revisions as stale', () => {
    expect(parseInteractiveValidation({ status: 'passed', message: 'Saída validada.', validatedAt: 1 }, 'current-revision-1')).toMatchObject({ status: 'stale', sourceRevision: 'legacy-unvalidated' })
  })

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

  it('runs a self-contained inline Java Main program', async () => {
    const result = await new ToolchainManager().execute(project('java', [['Main.java', 'public class Main { public static void main(String[] args) { System.out.println("java-inline-ok"); } }']], 'Main.java'))
    expect(result).toMatchObject({ exitCode: 0, stdout: 'java-inline-ok\n', phase: 'run' })
  }, 15_000)
})
