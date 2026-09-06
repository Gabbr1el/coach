import { ipcMain } from 'electron'
import { CODE_EXECUTION_CHANNELS } from '../../shared/contracts/code-execution-channels'
import { executeCodeInputSchema, executeProjectInputSchema } from '../../shared/contracts/code-execution-contract'
import { runPython } from '../code-execution/python-runner'
import { assertTrustedSender } from './trusted-sender'
import type { ObserverService } from '../../application/observer/observer-service'
import type { DrizzleProjectRepository } from '../repositories/drizzle-project-repository'
import type { CoachDatabase } from '../database/connection'
import { ToolchainManager } from '../code-execution/toolchain-manager'

const activeSenders = new Set<number>()

export function registerCodeExecutionHandlers(workspaceExists: (id: string) => Promise<boolean>, observer: ObserverService, projects?: DrizzleProjectRepository, database?: CoachDatabase, toolchains = new ToolchainManager()): void {
  ipcMain.handle(CODE_EXECUTION_CHANNELS.execute, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = executeCodeInputSchema.parse(payload)
    if (!await workspaceExists(input.workspaceId)) throw new Error('Workspace not found')
    if (activeSenders.has(event.sender.id)) throw new Error('A code execution is already running')
    activeSenders.add(event.sender.id)
    const controller = new AbortController()
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    try {
      const result = await runPython(input.content, controller.signal)
      let observerState
      try { observerState = observer.recordExecution(input.workspaceId, result) }
      catch (error) { console.error('Could not persist local execution event:', error instanceof Error ? error.message : 'unknown error') }
      return { ...result, observerState }
    }
    finally { event.sender.removeListener('destroyed', destroyed); activeSenders.delete(event.sender.id) }
  })
  ipcMain.handle(CODE_EXECUTION_CHANNELS.getToolchains, (event) => { assertTrustedSender(event); return toolchains.getStatuses() })
  ipcMain.handle(CODE_EXECUTION_CHANNELS.executeProject, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = executeProjectInputSchema.parse(payload)
    if (!await workspaceExists(input.workspaceId)) throw new Error('Workspace not found')
    const project = projects?.findById(input.projectId)
    if (!project || project.workspaceId !== input.workspaceId) throw new Error('Project not found')
    if (activeSenders.has(event.sender.id)) throw new Error('A code execution is already running')
    activeSenders.add(event.sender.id)
    const controller = new AbortController()
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    try {
      const result = await toolchains.execute(project, controller.signal)
      let observerState
      try { observerState = observer.recordExecution(input.workspaceId, result) } catch (error) { console.error('Could not persist local execution event:', error) }
      if (database) database.sqlite.prepare('INSERT INTO project_builds (id, project_id, command, exit_code, timed_out, duration_ms, stdout, stderr, diagnostics_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), project.id, result.command, result.exitCode, Number(result.timedOut), result.durationMs, result.stdout, result.stderr, JSON.stringify(result.diagnostics ?? []), Date.now())
      return { ...result, observerState }
    } finally { event.sender.removeListener('destroyed', destroyed); activeSenders.delete(event.sender.id) }
  })
}
