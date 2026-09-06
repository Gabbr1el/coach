import type { AIProviderManager } from '../ai/ai-provider-manager'
import { roadmapProposalSchema, type Roadmap } from '../../shared/contracts/roadmap-contract'
import type { Workspace } from '../../shared/contracts/workspace-contract'

export interface RoadmapRepository { findCurrent(workspaceId: string): Roadmap | null; nextVersion(workspaceId: string): number; create(roadmap: Roadmap): Roadmap; accept(workspaceId: string, roadmapId: string, now: number): Roadmap }

function fallback(workspace: Workspace) {
  const java = /java|poo|orienta.+objeto/i.test(`${workspace.name} ${workspace.objective}`)
  const modules = java ? [
    ['Classes e objetos', 'Modelar estado e comportamento em classes pequenas', ['Criar classes', 'Instanciar e usar objetos']],
    ['Encapsulamento', 'Proteger invariantes com campos privados e métodos', ['Aplicar modificadores de acesso', 'Validar estado no construtor']],
    ['Herança e composição', 'Escolher relações adequadas entre tipos', ['Usar composição', 'Reconhecer quando herança é apropriada']],
    ['Interfaces e polimorfismo', 'Programar por contratos e substituir implementações', ['Definir interfaces', 'Aplicar polimorfismo']],
    ['Projeto integrador', 'Combinar os conceitos em um projeto multi-arquivo', ['Organizar pacotes', 'Testar relações entre classes']],
  ] : [
    ['Fundamentos', `Construir a base de ${workspace.name}`, ['Explicar conceitos essenciais']],
    ['Prática guiada', 'Aplicar o conceito com apoio progressivo', ['Resolver exemplos guiados']],
    ['Prática independente', 'Resolver problemas sem resposta pronta', ['Validar a própria solução']],
    ['Projeto integrador', 'Consolidar conceitos em uma entrega', ['Explicar decisões e resultados']],
  ]
  return { title: `Roadmap: ${workspace.name}`, modules: modules.map(([title, objective, outcomes]) => ({ title: title as string, objective: objective as string, estimatedMinutes: 120, outcomes: outcomes as string[] })) }
}

function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)?.[1]
  return JSON.parse(fenced ?? content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1))
}

export class RoadmapService {
  constructor(private readonly repository: RoadmapRepository, private readonly providers: AIProviderManager, private readonly getWorkspace: (id: string) => Promise<Workspace | null>, private readonly now = Date.now, private readonly createId = () => crypto.randomUUID()) {}
  async get(workspaceId: string): Promise<Roadmap | null> { await this.requireWorkspace(workspaceId); return this.repository.findCurrent(workspaceId) }
  async generate(workspaceId: string): Promise<Roadmap> {
    const workspace = await this.requireWorkspace(workspaceId)
    let proposal = fallback(workspace)
    let providerId: string | null = 'coach-local'; let modelId: string | null = 'roadmap-rules-v1'
    const provider = this.providers.getActive()
    if (provider) try {
      const response = await provider.sendMessage({ messages: [{ role: 'system', content: 'Crie um roadmap acadêmico progressivo. Responda somente JSON válido: {"title":string,"modules":[{"title":string,"objective":string,"estimatedMinutes":number,"outcomes":[string]}]}. Use entre 3 e 10 módulos, sem inventar prazos.' }, { role: 'user', content: Buffer.from(JSON.stringify({ subject: workspace.name, objective: workspace.objective }), 'utf8').toString('base64') }], maxOutputTokens: 1200 })
      proposal = roadmapProposalSchema.parse(extractJson(response.content)); providerId = response.providerId; modelId = response.modelId
    } catch { /* deterministic proposal remains available offline or after invalid provider output */ }
    const now = this.now(); const version = this.repository.nextVersion(workspaceId)
    return this.repository.create({ id: this.createId(), workspaceId, title: proposal.title, status: 'proposed', version, providerId, modelId, modules: proposal.modules.map((module, index) => ({ id: this.createId(), ...module, position: index + 1, status: index === 0 ? 'available' : 'locked' })), createdAt: now, updatedAt: now })
  }
  async accept(workspaceId: string, roadmapId: string): Promise<Roadmap> { await this.requireWorkspace(workspaceId); return this.repository.accept(workspaceId, roadmapId, this.now()) }
  private async requireWorkspace(id: string): Promise<Workspace> { const workspace = await this.getWorkspace(id); if (!workspace || workspace.status !== 'active') throw new Error('Workspace not found'); return workspace }
}
