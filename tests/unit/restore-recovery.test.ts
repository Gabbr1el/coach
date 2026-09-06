import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { recoverPendingRestore, rollbackPendingRestore } from '../../src/main/database/restore-recovery'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function paths() { const directory = mkdtempSync(join(tmpdir(), 'coach-restore-')); directories.push(directory); const database = join(directory, 'coach.sqlite'); return { database, marker: `${database}.restore-pending`, staging: `${database}.restore-staging`, previous: `${database}.restore-previous` } }

describe('restore recovery', () => {
  it('promotes a validated staging database and keeps the previous copy', () => {
    const path = paths(); writeFileSync(path.database, 'current'); writeFileSync(path.staging, 'restored'); writeFileSync(path.marker, 'pending')
    recoverPendingRestore(path.database)
    expect(readFileSync(path.database, 'utf8')).toBe('restored')
    expect(readFileSync(path.previous, 'utf8')).toBe('current')
  })

  it('rolls back the previous database after a failed restored startup', () => {
    const path = paths(); writeFileSync(path.database, 'broken'); writeFileSync(path.previous, 'current'); writeFileSync(path.marker, 'pending')
    rollbackPendingRestore(path.database)
    expect(readFileSync(path.database, 'utf8')).toBe('current')
  })
})
