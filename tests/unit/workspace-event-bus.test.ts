import { describe, expect, it } from 'vitest'
import { createWorkspaceEvent, WorkspaceEventBus } from '../../src/application/events/workspace-event-bus'

describe('WorkspaceEventBus', () => {
  it('publishes typed events and supports unsubscription', () => {
    const bus = new WorkspaceEventBus()
    const received: string[] = []
    const unsubscribe = bus.subscribe((event) => { received.push(event.type) })
    bus.publish(createWorkspaceEvent('workspace-1', 'session-1', 'timer.changed', {}, 1))
    unsubscribe()
    bus.publish(createWorkspaceEvent('workspace-1', 'session-1', 'plan.changed', {}, 2))
    expect(received).toEqual(['timer.changed'])
  })
})
