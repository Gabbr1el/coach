import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodeExecutionResult } from '../../shared/contracts/code-execution-contract'

const MAX_OUTPUT_BYTES = 64_000
const TIMEOUT_MS = 5_000
const BWRAP_PATH = '/usr/bin/bwrap'
const PYTHON_PATH = '/usr/bin/python3'
const PRLIMIT_PATH = '/usr/bin/prlimit'
let sandboxVerified = false

function sandboxArguments(program: string[], readOnlyFiles: ReadonlyArray<[string, string]> = []): string[] {
  const fileArguments = readOnlyFiles.flatMap(([source, destination]) => ['--ro-bind', source, destination])
  return ['--die-with-parent', '--new-session', '--unshare-all', '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64', ...fileArguments, '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '--chdir', '/', '--setenv', 'HOME', '/tmp', '--setenv', 'PYTHONIOENCODING', 'utf-8', PRLIMIT_PATH, '--cpu=4:4', '--fsize=2097152:2097152', '--nofile=32:32', '--nproc=32:32', '--as=268435456:268435456', ...program]
}

export function assertPythonSandboxAvailable(): void {
  if (sandboxVerified) return
  if (process.platform !== 'linux') throw new Error('A execução segura de Python está disponível somente no Linux nesta versão')
  try {
    execFileSync(BWRAP_PATH, ['--version'], { stdio: 'ignore', timeout: 2_000 })
    execFileSync(BWRAP_PATH, sandboxArguments([PYTHON_PATH, '-I', '-c', 'print(1)']), { stdio: 'ignore', timeout: 2_000 })
    sandboxVerified = true
  } catch {
    throw new Error('O sandbox Bubblewrap e o Python 3 são necessários para executar código')
  }
}

function signature(stderr: string): string | null {
  const normalized = stderr.replace(/\/tmp\/coach-run-[^/]+\/main\.py/g, 'main.py').replace(/line \d+/g, 'line #').trim()
  return normalized ? createHash('sha256').update(normalized).digest('hex').slice(0, 16) : null
}

export async function runPython(content: string, signal?: AbortSignal): Promise<CodeExecutionResult> {
  assertPythonSandboxAvailable()
  const directory = await mkdtemp(join(tmpdir(), 'coach-run-'))
  const file = join(directory, 'main.py')
  await writeFile(file, content, { encoding: 'utf8', mode: 0o600 })
  const startedAt = Date.now()
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(BWRAP_PATH, sandboxArguments([PYTHON_PATH, '-I', '-B', '/main.py'], [[file, '/main.py']]), { cwd: directory, env: {}, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true })
      let stdout = ''
      let stderr = ''
      let outputBytes = 0
      let timedOut = false
      const capture = (target: 'stdout' | 'stderr') => (chunk: Buffer) => {
        const remaining = Math.max(0, MAX_OUTPUT_BYTES - outputBytes)
        const slice = chunk.subarray(0, remaining)
        outputBytes += slice.byteLength
        if (target === 'stdout') stdout += slice.toString('utf8')
        else stderr += slice.toString('utf8')
        if (outputBytes >= MAX_OUTPUT_BYTES) { try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') } }
      }
      child.stdout.on('data', capture('stdout'))
      child.stderr.on('data', capture('stderr'))
      child.once('error', reject)
      const timeout = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') } }, TIMEOUT_MS)
      const abort = () => { try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') } }
      signal?.addEventListener('abort', abort, { once: true })
      child.once('close', (exitCode) => {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
        if (outputBytes >= MAX_OUTPUT_BYTES) stderr += '\n[Saída interrompida pelo limite do Coach.]'
        if (timedOut) stderr += '\n[Execução interrompida após 5 segundos.]'
        resolve({ command: 'python3 -I -B main.py', stdout, stderr, exitCode, timedOut, durationMs: Date.now() - startedAt, errorSignature: signature(stderr) })
      })
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
