import { describe, expect, it, vi } from 'vitest'
import { CurriculumSourceService } from '../../src/application/roadmaps/curriculum-source-service'
import { HttpsCurriculumSourceGateway } from '../../src/main/gateways/https-curriculum-source-gateway'

const source = { id: 'test', title: 'Test', url: 'https://docs.python.org/3/tutorial/', type: 'documentation' as const, authority: 'PSF', retrieved: false, retrievedAt: null, excerpt: null }
describe('curriculum sources', () => {
  it('does not treat a known URL as retrieved content', async () => { const service = new CurriculumSourceService({ retrieve: async (value) => value }); const [result] = await service.sourcesFor({ id: 'w', name: 'Python', objective: '', status: 'active', createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }); expect(result).toMatchObject({ retrieved: false, excerpt: null }) })
  it('rejects external URLs outside the HTTPS allowlist', async () => { const gateway = new HttpsCurriculumSourceGateway(vi.fn() as any); await expect(gateway.retrieve({ ...source, url: 'https://evil.example/curriculum' })).rejects.toThrow('NOT_ALLOWED'); await expect(gateway.retrieve({ ...source, url: 'http://docs.python.org/3/tutorial/' })).rejects.toThrow('NOT_ALLOWED') })
  it('retrieves only text and strips scripts', async () => { const fetcher = vi.fn(async () => new Response('<main>Useful C text<script>alert(1)</script></main>', { headers: { 'content-type': 'text/html' } })); const result = await new HttpsCurriculumSourceGateway(fetcher as any, () => 10).retrieve(source); expect(result).toMatchObject({ retrieved: true, retrievedAt: 10 }); expect(result.excerpt).toContain('Useful C text'); expect(result.excerpt).not.toContain('alert') })
  it('limits sources to three per generation', async () => { const calls: string[] = []; const service = new CurriculumSourceService({ retrieve: async (value) => { calls.push(value.id); return value } }); await service.sourcesFor({ id: 'w', name: 'C', objective: 'linguagem c', status: 'active', createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }); expect(calls.length).toBeLessThanOrEqual(3) })
})
