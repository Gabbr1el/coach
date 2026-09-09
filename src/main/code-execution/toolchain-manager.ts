import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CodeDiagnostic, CodeExecutionResult, ToolchainStatus } from '../../shared/contracts/code-execution-contract'
import type { ProjectFile, ProjectLanguage, WorkspaceProject } from '../../shared/contracts/project-contract'
import { BWRAP_PATH, sandboxArguments, spawnLimited } from './sandbox'

const COMMANDS: Record<ProjectLanguage, string> = { python: '/usr/bin/python3', c: '/usr/bin/gcc', java: '/usr/bin/javac' }

export function parseDiagnostics(language: ProjectLanguage, stderr: string): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = []
  if (language === 'python') {
    const frame = /File "\/?project\/(.+?)", line (\d+)/g
    for (const match of stderr.matchAll(frame)) {
      const lines = stderr.slice(match.index + match[0].length).split('\n').map((line) => line.trim()).filter(Boolean)
      const detail = lines.find((line) => /^(?:[A-Za-z]+Error|SyntaxError|IndentationError|TabError):/.test(line)) ?? lines.at(-1) ?? 'Erro de execução'
      diagnostics.push({ filePath: match[1]!, line: Number(match[2]), column: 1, severity: 'error', message: detail, code: detail.split(':', 1)[0] ?? null })
    }
    return diagnostics
  }
  const pattern = language === 'java' ? /^\/?project\/(.+\.java):(\d+):\s+(error|warning):\s+(.+)$/gm : /^\/?project\/(.+?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.+)$/gm
  for (const match of stderr.matchAll(pattern)) diagnostics.push({ filePath: match[1]!, line: Number(match[2]), column: language === 'java' ? 1 : Number(match[3]), severity: (language === 'java' ? match[3] : match[4])!.includes('error') ? 'error' : (language === 'java' ? match[3] : match[4]) === 'warning' ? 'warning' : 'info', message: (language === 'java' ? match[4] : match[5])!, code: null })
  return diagnostics
}

async function materialize(root: string, files: ProjectFile[]): Promise<void> {
  for (const file of files) { const target = join(root, file.path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, file.content, { encoding: 'utf8', mode: 0o600 }) }
}

export class ToolchainManager {
  getStatuses(): ToolchainStatus[] {
    return (Object.keys(COMMANDS) as ProjectLanguage[]).map((language) => {
      const command = COMMANDS[language]
      try { execFileSync(BWRAP_PATH, ['--version'], { timeout: 2_000, stdio: 'ignore' }); execFileSync('/usr/bin/prlimit', ['--version'], { timeout: 2_000, stdio: 'ignore' }); if (language === 'java') execFileSync('/usr/bin/java', ['-version'], { timeout: 2_000, stdio: 'ignore' }); const flag = language === 'java' ? '-version' : '--version'; const output = execFileSync(command, [flag], { timeout: 2_000, encoding: 'utf8', stdio: ['ignore', 'pipe', language === 'java' ? 'pipe' : 'ignore'] }); return { language, available: true, command, version: output.trim().split('\n')[0] || null, detail: null } }
      catch { return { language, available: false, command, version: null, detail: 'Toolchain ou sandbox não disponível' } }
    })
  }

  async execute(project: WorkspaceProject, signal?: AbortSignal): Promise<CodeExecutionResult> {
    if (process.platform !== 'linux') throw new Error('A execução segura está disponível somente no Linux nesta versão')
    execFileSync(BWRAP_PATH, ['--version'], { stdio: 'ignore', timeout: 2_000 })
    const directory = await mkdtemp(join(tmpdir(), 'coach-project-'))
    await materialize(directory, project.files)
    try {
      if (project.language === 'python') {
        const result = await spawnLimited(BWRAP_PATH, sandboxArguments(['/usr/bin/python3', '-I', '-B', `/project/${project.entryFilePath}`], [{ source: directory, destination: '/project' }], '/project'), `python3 -I -B ${project.entryFilePath}`, 5_000, signal)
        return { ...result, phase: 'run', diagnostics: parseDiagnostics('python', result.stderr) }
      }
      if (project.language === 'c') {
        const sources = project.files.filter((file) => file.path.endsWith('.c')).map((file) => `/project/${file.path}`)
        const compile = await spawnLimited(BWRAP_PATH, sandboxArguments(['/usr/bin/gcc', '-std=c17', '-Wall', '-Wextra', '-pedantic', ...sources, '-o', '/project/.coach-program'], [{ source: directory, destination: '/project', writable: true }], '/project'), `gcc -std=c17 -Wall -Wextra -pedantic ${sources.map((path) => path.replace('/project/', '')).join(' ')} -o .coach-program`, 8_000, signal)
        const diagnostics = parseDiagnostics('c', compile.stderr)
        if (compile.exitCode !== 0) return { ...compile, phase: 'compile', diagnostics }
        return { ...await spawnLimited(BWRAP_PATH, sandboxArguments(['/project/.coach-program'], [{ source: directory, destination: '/project' }], '/project'), './.coach-program', 5_000, signal), phase: 'run', diagnostics }
      }
      const sources = project.files.filter((file) => file.path.endsWith('.java')).map((file) => `/project/${file.path}`)
      const compile = await spawnLimited(BWRAP_PATH, sandboxArguments(['/usr/bin/javac', '-J-Xms16m', '-J-Xmx256m', '-J-XX:+UseSerialGC', '-J-XX:CompressedClassSpaceSize=64m', '-J-XX:MaxMetaspaceSize=192m', '-encoding', 'UTF-8', '-d', '/project/.coach-out', ...sources], [{ source: directory, destination: '/project', writable: true }], '/project', { JAVA_HOME: '/usr/lib/jvm/default-java' }, 2_147_483_648), `javac -encoding UTF-8 -d .coach-out ${sources.map((path) => path.replace('/project/', '')).join(' ')}`, 10_000, signal)
      const diagnostics = parseDiagnostics('java', compile.stderr)
      if (compile.exitCode !== 0) return { ...compile, phase: 'compile', diagnostics }
      const mainClass = project.entryFilePath.replace(/^src\//, '').replace(/\.java$/, '').replaceAll('/', '.')
      return { ...await spawnLimited(BWRAP_PATH, sandboxArguments(['/usr/bin/java', '-Xms16m', '-Xmx256m', '-XX:+UseSerialGC', '-XX:CompressedClassSpaceSize=64m', '-XX:MaxMetaspaceSize=192m', '-cp', '/project/.coach-out', mainClass], [{ source: directory, destination: '/project' }], '/project', { JAVA_HOME: '/usr/lib/jvm/default-java' }, 2_147_483_648), `java -cp .coach-out ${mainClass}`, 5_000, signal), phase: 'run', diagnostics }
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
}
