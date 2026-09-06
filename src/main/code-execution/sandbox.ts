import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { CodeExecutionResult } from '../../shared/contracts/code-execution-contract'

export const BWRAP_PATH = '/usr/bin/bwrap'
export const PRLIMIT_PATH = '/usr/bin/prlimit'
export const MAX_OUTPUT_BYTES = 64_000

export function sandboxArguments(program: string[], binds: ReadonlyArray<{ source: string; destination: string; writable?: boolean }> = [], chdir = '/', environment: Record<string, string> = {}, addressSpaceBytes = 1_073_741_824): string[] {
  const fileArguments = binds.flatMap(({ source, destination, writable }) => [writable ? '--bind' : '--ro-bind', source, destination])
  const environmentArguments = Object.entries(environment).flatMap(([name, value]) => ['--setenv', name, value])
  return ['--die-with-parent', '--new-session', '--unshare-all', '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64', '--ro-bind-try', '/etc/alternatives', '/etc/alternatives', ...fileArguments, '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '--chdir', chdir, '--setenv', 'HOME', '/tmp', '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', ...environmentArguments, PRLIMIT_PATH, '--cpu=8:8', '--fsize=8388608:8388608', '--nofile=64:64', '--nproc=64:64', `--as=${addressSpaceBytes}:${addressSpaceBytes}`, ...program]
}

export function errorSignature(stderr: string): string | null {
  const normalized = stderr.replace(/\/tmp\/coach-[^/]+/g, '').replace(/:\d+:\d+/g, ':#:#').replace(/line \d+/g, 'line #').trim()
  return normalized ? createHash('sha256').update(normalized).digest('hex').slice(0, 16) : null
}

export async function spawnLimited(command: string, args: string[], displayCommand: string, timeoutMs: number, signal?: AbortSignal): Promise<CodeExecutionResult> {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: {}, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let timedOut = false
    const kill = () => { try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    const capture = (target: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const slice = chunk.subarray(0, Math.max(0, MAX_OUTPUT_BYTES - outputBytes))
      outputBytes += slice.byteLength
      if (target === 'stdout') stdout += slice.toString('utf8'); else stderr += slice.toString('utf8')
      if (outputBytes >= MAX_OUTPUT_BYTES) kill()
    }
    child.stdout.on('data', capture('stdout'))
    child.stderr.on('data', capture('stderr'))
    child.once('error', reject)
    const timeout = setTimeout(() => { timedOut = true; kill() }, timeoutMs)
    signal?.addEventListener('abort', kill, { once: true })
    child.once('close', (exitCode) => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', kill)
      if (outputBytes >= MAX_OUTPUT_BYTES) stderr += '\n[Saída interrompida pelo limite do Coach.]'
      if (timedOut) stderr += '\n[Execução interrompida pelo limite de tempo do Coach.]'
      resolve({ command: displayCommand, stdout, stderr, exitCode, timedOut, durationMs: Date.now() - startedAt, errorSignature: errorSignature(stderr) })
    })
  })
}
