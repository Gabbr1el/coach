import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handle: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../src/main/ipc/trusted-sender', () => ({ assertTrustedSender: vi.fn() }))

import { registerExerciseHandlers } from '../../src/main/ipc/exercise-handlers'
import { EXERCISE_CHANNELS } from '../../src/shared/contracts/exercise-channels'

describe('exercise IPC read path', () => {
  beforeEach(() => mocks.handle.mockClear())

  it('returns null on cache miss without invoking synchronous generation', async () => {
    const service = { getSet: vi.fn(() => null), ensureSet: vi.fn() }
    registerExerciseHandlers(service as never)
    const handler = mocks.handle.mock.calls.find(([channel]) => channel === EXERCISE_CHANNELS.getSet)?.[1]
    expect(await handler({}, { workspaceId: '00000000-0000-4000-8000-000000000001', topicId: 'module:topic' })).toBeNull()
    expect(service.getSet).toHaveBeenCalledOnce()
    expect(service.ensureSet).not.toHaveBeenCalled()
  })
})
