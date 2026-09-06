import { ipcMain } from 'electron'
import { CODE_EXECUTION_CHANNELS } from '../../shared/contracts/code-execution-channels'
import { executeCodeInputSchema } from '../../shared/contracts/code-execution-contract'
import { runPython } from '../code-execution/python-runner'
import { assertTrustedSender } from './trusted-sender'

const activeSenders = new Set<number>()

export function registerCodeExecutionHandlers(workspaceExists: (id: string) => Promise<boolean>): void {
  ipcMain.handle(CODE_EXECUTION_CHANNELS.execute, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = executeCodeInputSchema.parse(payload)
    if (!await workspaceExists(input.workspaceId)) throw new Error('Workspace not found')
    if (activeSenders.has(event.sender.id)) throw new Error('A code execution is already running')
    activeSenders.add(event.sender.id)
    const controller = new AbortController()
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    try { return await runPython(input.content, controller.signal) }
    finally { event.sender.removeListener('destroyed', destroyed); activeSenders.delete(event.sender.id) }
  })
}
