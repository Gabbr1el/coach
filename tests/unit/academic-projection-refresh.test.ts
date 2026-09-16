import { describe, expect, it, vi } from 'vitest'
import { refreshAcademicProjections } from '../../src/renderer/app/academic-projection-refresh'

describe('refreshAcademicProjections', () => {
  it('replans before reading every backend-authoritative dependent projection', async () => {
    const order: string[] = []
    const read = <T>(name: string, value: T) => vi.fn(async () => { order.push(name); return value })
    const replanWeek = vi.fn(async () => { order.push('replan'); return { id: 'plan', revision: 1, timezone: 'UTC', weekStart: '2026-09-14', generatedAt: 1, days: [] } })
    const snapshot = await refreshAcademicProjections({
      replanWeek,
      listWorkspaces: read('workspaces', []),
      listPriorities: read('priorities', []),
      getSchedule: read('schedule', []),
      getAcademicOverview: read('academic', { availability: [], workspaces: [], routine: [], events: [] }),
      getAcademicLife: read('life', { generatedAt: 1, current: [], history: [] }),
      getReports: read('reports', { generatedAt: 1, workspaces: [], totals: {} } as never),
    })
    expect(order[0]).toBe('replan')
    expect(new Set(order.slice(1))).toEqual(new Set(['workspaces', 'priorities', 'schedule', 'academic', 'life', 'reports']))
    expect(snapshot.workspaces).toEqual([])
  })
})
