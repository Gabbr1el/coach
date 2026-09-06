import { ipcMain } from 'electron'
import { CODE_EXECUTION_CHANNELS } from '../../shared/contracts/code-execution-channels'
import { executeCodeInputSchema } from '../../shared/contracts/code-execution-contract'
import { runPython } from '../code-execution/python-runner'
import { assertTrustedSender } from './trusted-sender'
import type { ObserverService } from '../../application/observer/observer-service'

const activeSenders = new Set<number>()

export function registerCodeExecutionHandlers(workspaceExists: (id: string) => Promise<boolean>, observer: ObserverService): void {
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
}
