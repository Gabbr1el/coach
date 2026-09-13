import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { DrizzleWorkspaceRepository } from '../../src/main/repositories/drizzle-workspace-repository'
import { SqliteWorkspaceProvisioningRepository } from '../../src/main/repositories/sqlite-workspace-provisioning-repository'
import { WorkspaceProvisioningService } from '../../src/application/workspaces/workspace-provisioning-service'
import { WorkspaceService } from '../../src/application/workspaces/workspace-service'
import { PdfMaterialService } from '../../src/main/materials/pdf-material-service'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'coach-draft-'))
  directories.push(directory)
  const database = openCoachDatabase({ databasePath: join(directory, 'coach.sqlite'), migrationsFolder: resolve('drizzle/migrations') })
  const repository = new DrizzleWorkspaceRepository(database)
  const provisioningRepository = new SqliteWorkspaceProvisioningRepository(database)
  const initializeContent = vi.fn()
  const provisioning = new WorkspaceProvisioningService({ repository: provisioningRepository, initializeContent, ensureRoadmap: async () => ({ status: 'ready', activeRoadmapId: null, lastErrorCode: null, retryAfter: null }), getRoadmap: async () => null, ensureLesson: async () => ({ status: 'failed_retryable', errorCode: 'PROVIDER_REQUEST_FAILED' }), listReadyMaterialIds: (id) => database.sqlite.prepare("SELECT id FROM materials WHERE workspace_id=? AND status='ready'").all(id).map((row: any) => row.id) })
  const service = new WorkspaceService({ repository, createId: () => crypto.randomUUID(), provisioning, validateAnalysis: () => true })
  return { database, repository, provisioningRepository, initializeContent, service }
}

const input = (name: string) => ({ name, objective: `Aprender ${name}`, analysisToken: 'token', analysisRevision: 1 })

describe('workspace draft lifecycle with migrated SQLite', () => {
  it('A/G prepares without ambiguous SQL or starting content', async () => {
    const { database, service, provisioningRepository, initializeContent } = setup()
    const draft = await service.prepareDraft(input('Álgebra'))
    expect(provisioningRepository.find(draft.id)?.status).toBe('draft')
    expect(initializeContent).not.toHaveBeenCalled()
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM content_jobs WHERE workspace_id=?').get(draft.id)).toEqual({ count: 0 })
    database.close()
  })

  it('compensates when createDraft fails before a provisioning row exists', async () => {
    const { database, repository } = setup()
    const contexts: string[] = []
    const globalContexts: string[] = []
    const service = new WorkspaceService({ repository, academicContext: { record: (value: { subject: string }) => { globalContexts.push(value.subject) } } as never, validateAnalysis: () => true, provisioning: { createDraft: () => { throw new Error('create draft failed') }, get: () => null, start: () => { throw new Error('unexpected') }, retry: () => { throw new Error('unexpected') }, discardDraft: () => {} }, createAcademicContexts: (_id, name) => { contexts.push(name) } })
    await expect(service.prepareDraft(input('Falha'))).rejects.toThrow('create draft failed')
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM workspaces').get()).toEqual({ count: 0 })
    expect(await repository.listActive()).toEqual([])
    expect(contexts).toEqual([])
    expect(globalContexts).toEqual([])
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM academic_subject_contexts').get()).toEqual({ count: 0 })
    database.close()
  })

  it('B keeps drafts hidden from active workspaces', async () => {
    const { database, repository, service } = setup()
    await service.prepareDraft(input('Cálculo'))
    expect(await repository.listActive()).toEqual([])
    database.close()
  })

  it('C/D cascades draft materials and chunks but cannot discard a confirmed workspace', async () => {
    const { database, service } = setup()
    const draft = await service.prepareDraft(input('Física'))
    database.sqlite.prepare("INSERT INTO materials (id,workspace_id,name,media_type,page_count,status,relevance,created_at) VALUES ('m',?,'a.pdf','application/pdf',1,'staged',0,1)").run(draft.id)
    database.sqlite.prepare("INSERT INTO material_chunks (id,material_id,page_number,content) VALUES ('c','m',1,'texto')").run()
    service.discardDraft(draft.id)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM materials').get()).toEqual({ count: 0 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM material_chunks').get()).toEqual({ count: 0 })
    const confirmed = await service.create(input('Química'))
    service.discardDraft(confirmed.id)
    expect(await service.open(confirmed.id)).not.toBeNull()
    database.close()
  })

  it('E promotes the prepared workspace and starts content once', async () => {
    const { database, service, initializeContent } = setup()
    const draft = await service.prepareDraft(input('História'))
    database.sqlite.prepare("INSERT INTO materials (id,workspace_id,name,media_type,page_count,status,relevance,created_at) VALUES ('m',?,'a.pdf','application/pdf',1,'ready',90,1)").run(draft.id)
    const created = await service.create({ ...input('História'), draftId: draft.id })
    expect(created.id).toBe(draft.id)
    expect(initializeContent).toHaveBeenCalledTimes(1)
    expect(database.sqlite.prepare('SELECT workspace_id AS workspaceId FROM materials WHERE id=\'m\'').get()).toEqual({ workspaceId: draft.id })
    database.close()
  })

  it('keeps a prepared draft discardable and does not start when context publication fails', async () => {
    const { database, service, provisioningRepository, initializeContent } = setup()
    const draft = await service.prepareDraft(input('Contexto preparado'))
    const failing = new WorkspaceService({ repository: new DrizzleWorkspaceRepository(database), validateAnalysis: () => true, provisioning: { createDraft: (id) => service.getProvisioning(id)!, get: (id) => provisioningRepository.find(id), start: () => { throw new Error('start must not run') }, retry: () => { throw new Error('unexpected') }, discardDraft: (id) => service.discardDraft(id) }, createAcademicContexts: () => { throw new Error('context failed') } })
    await expect(failing.create({ ...input('Contexto preparado'), draftId: draft.id })).rejects.toThrow('context failed')
    expect(provisioningRepository.find(draft.id)?.status).toBe('draft')
    expect(initializeContent).not.toHaveBeenCalled()
    service.discardDraft(draft.id)
    expect(await service.open(draft.id)).toBeNull()
    database.close()
  })

  it('compensates direct create when context publication fails before start', async () => {
    const { database, repository, provisioningRepository, initializeContent } = setup()
    const provisioning = new WorkspaceProvisioningService({ repository: provisioningRepository, initializeContent, ensureRoadmap: async () => ({ status: 'ready', activeRoadmapId: null, lastErrorCode: null, retryAfter: null }), getRoadmap: async () => null, ensureLesson: async () => ({ status: 'failed_retryable', errorCode: 'PROVIDER_REQUEST_FAILED' }), listReadyMaterialIds: () => [] })
    const service = new WorkspaceService({ repository, validateAnalysis: () => true, provisioning, createAcademicContexts: () => { throw new Error('context failed') } })
    await expect(service.create(input('Contexto direto'))).rejects.toThrow('context failed')
    expect(await repository.listActive()).toEqual([])
    expect(initializeContent).not.toHaveBeenCalled()
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM academic_subject_contexts').get()).toEqual({ count: 0 })
    database.close()
  })

  it('rolls back newly published contexts when prepared start throws before promotion', async () => {
    const { database, repository, service, provisioningRepository, initializeContent } = setup()
    const draft = await service.prepareDraft(input('Start preparado'))
    let published = false
    const failing = new WorkspaceService({ repository, validateAnalysis: () => true, provisioning: { createDraft: (id) => provisioningRepository.find(id)!, get: (id) => provisioningRepository.find(id), start: () => { throw new Error('start failed') }, retry: () => { throw new Error('unexpected') }, discardDraft: (id) => service.discardDraft(id) }, createAcademicContexts: () => { published = true; return () => { published = false } } })
    await expect(failing.create({ ...input('Start preparado'), draftId: draft.id })).rejects.toThrow('start failed')
    expect(published).toBe(false)
    expect(provisioningRepository.find(draft.id)?.status).toBe('draft')
    expect(initializeContent).not.toHaveBeenCalled()
    expect(() => service.discardDraft(draft.id)).not.toThrow()
    expect(await service.open(draft.id)).toBeNull()
    database.close()
  })

  it('rolls back contexts and direct workspace when start throws before promotion', async () => {
    const { database, repository, provisioningRepository, initializeContent } = setup()
    let published = false
    const service = new WorkspaceService({ repository, validateAnalysis: () => true, provisioning: { createDraft: (id) => new WorkspaceProvisioningService({ repository: provisioningRepository, initializeContent, ensureRoadmap: async () => ({ status: 'ready', activeRoadmapId: null, lastErrorCode: null, retryAfter: null }), getRoadmap: async () => null, ensureLesson: async () => ({ status: 'failed_retryable', errorCode: 'PROVIDER_REQUEST_FAILED' }), listReadyMaterialIds: () => [] }).createDraft(id), get: (id) => provisioningRepository.find(id), start: () => { throw new Error('start failed') }, retry: () => { throw new Error('unexpected') }, discardDraft: (id) => { provisioningRepository.removeDraft(id) } }, createAcademicContexts: () => { published = true; return () => { published = false } } })
    await expect(service.create(input('Start direto'))).rejects.toThrow('start failed')
    expect(published).toBe(false)
    expect(await repository.listActive()).toEqual([])
    expect(initializeContent).not.toHaveBeenCalled()
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_provisioning').get()).toEqual({ count: 0 })
    database.close()
  })

  it('F creates two consecutive independent workspaces', async () => {
    const { database, service } = setup()
    const first = await service.create(input('Geografia'))
    const second = await service.create(input('Biologia'))
    expect(second.id).not.toBe(first.id)
    expect(await service.list()).toHaveLength(2)
    database.close()
  })

  it('H leaves an existing workspace untouched when a draft is discarded', async () => {
    const { database, service } = setup()
    const existing = await service.create(input('Português'))
    const draft = await service.prepareDraft(input('Inglês'))
    service.discardDraft(draft.id)
    expect(await service.open(existing.id)).toMatchObject({ id: existing.id, name: 'Português' })
    database.close()
  })

  it('retries the same material after an extraction failure', async () => {
    const { database, service } = setup()
    const draft = await service.prepareDraft(input('Literatura'))
    let attempts = 0
    const materials = new PdfMaterialService(database, { createId: () => crypto.randomUUID(), extractPages: async () => { attempts += 1; if (attempts === 1) throw new Error('internal extractor details'); return ['Literatura texto válido'] } })
    const path = join(directories.at(-1)!, 'material.pdf')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, Uint8Array.from([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0x0a,0x25,0xc7,0xec,0x8f,0xa2,0x0a]))
    await expect(materials.importFile(draft.id, path)).rejects.toThrow()
    await expect(materials.importFile(draft.id, path)).resolves.toMatchObject({ status: 'staged' })
    expect(attempts).toBe(2)
    database.close()
  })

  it('persists only a public material failure message', async () => {
    const { database, service } = setup()
    const draft = await service.prepareDraft(input('Material seguro'))
    const materials = new PdfMaterialService(database, { extractPages: async () => { throw new Error("SqliteError SELECT /tmp/private.pdf execFile '/usr/bin/tool'") } })
    const path = join(directories.at(-1)!, 'unsafe.pdf')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, Uint8Array.from([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0x0a,0x25,0xc7,0xec,0x8f,0xa2,0x0a]))
    await expect(materials.importFile(draft.id, path)).rejects.toThrow()
    expect(materials.list(draft.id)[0]?.errorMessage).toBe('Não foi possível processar o material. Verifique o arquivo e tente novamente.')
    expect(materials.list(draft.id)[0]?.errorMessage).not.toMatch(/SELECT|\/tmp|execFile|SqliteError/)
    database.close()
  })
})
