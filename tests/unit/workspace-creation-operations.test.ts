import { describe, expect, it, vi } from 'vitest'
import { publicCreationError, WorkspaceCreationOperations } from '../../src/renderer/app/workspace-creation-operations'

describe('WorkspaceCreationOperations', () => {
  it('serializes operations and rejects stale completion after invalidation', async () => {
    const controller = new WorkspaceCreationOperations()
    let release!: () => void
    const first = controller.run(async (generation) => { await new Promise<void>((resolve) => { release = resolve }); return controller.isCurrent(generation) ? 'stale' : undefined })
    await Promise.resolve()
    const invalidated = controller.invalidate(async () => {})
    release()
    await expect(first).resolves.toBeUndefined()
    await expect(invalidated).resolves.toBeUndefined()
  })

  it('runs close after the active operation and blocks later work', async () => {
    const controller = new WorkspaceCreationOperations()
    const order: string[] = []
    await controller.run(async () => { order.push('attach') })
    await controller.close(async () => { order.push('close') })
    await expect(controller.run(async () => { order.push('late') })).resolves.toBeUndefined()
    expect(order).toEqual(['attach', 'close'])
  })

  it.each([null, 'draft-id'])('coalesces synchronous double submit with draft %s', async (draftId) => {
    const controller = new WorkspaceCreationOperations()
    let release!: () => void
    const submit = vi.fn(async (_draftId: string | null) => new Promise<void>((resolve) => { release = resolve }))
    const first = controller.submit(() => submit(draftId))
    const second = controller.submit(() => submit(draftId))
    await Promise.resolve()
    expect(submit).toHaveBeenCalledTimes(1)
    await expect(second).resolves.toBeUndefined()
    release()
    await expect(first).resolves.toBeUndefined()
  })
})

describe('publicCreationError', () => {
  it('hides raw SQLite, SQL, exec and paths', () => {
    expect(publicCreationError(new Error("SqliteError: ambiguous column workspace_id SELECT * FROM /tmp/private.pdf"))).toBe('Não foi possível criar o Workspace. Revise os dados e tente novamente.')
  })

  it('preserves the duplicate marker', () => {
    expect(publicCreationError(new Error("Error invoking remote method: WORKSPACE_DUPLICATE|abc|Álgebra"))).toBe('WORKSPACE_DUPLICATE|abc|Álgebra')
  })
})
