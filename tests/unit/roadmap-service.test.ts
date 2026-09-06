import { describe, expect, it } from 'vitest'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import { RoadmapService, type RoadmapRepository } from '../../src/application/roadmaps/roadmap-service'
import type { Roadmap } from '../../src/shared/contracts/roadmap-contract'

class MemoryRoadmaps implements RoadmapRepository { roadmap: Roadmap | null = null; findCurrent() { return this.roadmap }; nextVersion() { return 1 }; create(value: Roadmap) { this.roadmap = value; return value }; accept(_workspaceId: string, _roadmapId: string, now: number) { this.roadmap = { ...this.roadmap!, status: 'accepted', updatedAt: now }; return this.roadmap } }
const workspace = { id: crypto.randomUUID(), name: 'POO com Java', objective: 'Aprender orientação a objetos', status: 'active' as const, createdAt: 1, updatedAt: 1, lastOpenedAt: null, archivedAt: null }
describe('RoadmapService', () => { it('builds and accepts an offline Java roadmap', async () => { const repository = new MemoryRoadmaps(); const service = new RoadmapService(repository, new AIProviderManager(), async () => workspace, () => 10); const roadmap = await service.generate(workspace.id); expect(roadmap.modules.map((module) => module.title)).toContain('Classes e objetos'); expect((await service.accept(workspace.id, roadmap.id)).status).toBe('accepted') }) })
