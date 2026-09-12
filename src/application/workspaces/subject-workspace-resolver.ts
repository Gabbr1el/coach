import type { Workspace } from '../../shared/contracts/workspace-contract'

export interface SubjectWorkspaceCandidate {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly confidence: number
  readonly reason: string
  readonly tier: 'exact' | 'confirmed_context' | 'semantic'
}

export type SubjectWorkspaceResolution =
  | { readonly status: 'resolved'; readonly candidate: SubjectWorkspaceCandidate }
  | { readonly status: 'suggested'; readonly candidate: SubjectWorkspaceCandidate }
  | { readonly status: 'ambiguous'; readonly candidates: readonly SubjectWorkspaceCandidate[] }
  | { readonly status: 'none'; readonly candidates: readonly [] }

export interface SubjectWorkspaceResolverDependencies {
  readonly listWorkspaces: () => Promise<Workspace[]>
  readonly listAcademicRelations: () => Array<{ workspaceId: string; subject: string; relation: string }>
  readonly suggestSemantic?: (input: { subject: string; workspaces: Array<{ id: string; name: string; contextSubjects: string[] }> }) => Promise<Array<{ workspaceId: string; confidence: number; reason: string }>>
}

export interface SubjectWorkspaceResolutionPolicy {
  readonly allowSemantic: boolean
  readonly semanticWorkspaceIds?: readonly string[]
}

function key(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9+#]+/g, ' ').trim() }

export class SubjectWorkspaceResolver {
  constructor(private readonly dependencies: SubjectWorkspaceResolverDependencies) {}

  async resolve(subject: string, policy: SubjectWorkspaceResolutionPolicy = { allowSemantic: true }): Promise<SubjectWorkspaceResolution> {
    const workspaces = (await this.dependencies.listWorkspaces()).filter((workspace) => workspace.status === 'active')
    const normalized = key(subject)
    const exact = workspaces.filter((workspace) => key(workspace.name) === normalized).map((workspace) => this.candidate(workspace, 1, 'O nome do Workspace corresponde exatamente à matéria.', 'exact'))
    if (exact.length === 1) return { status: 'resolved', candidate: exact[0]! }
    if (exact.length > 1) return { status: 'ambiguous', candidates: exact }

    const relations = this.dependencies.listAcademicRelations()
    const confirmedIds = new Set(relations.filter((relation) => ['primary', 'implementation_language', 'user_selected'].includes(relation.relation) && key(relation.subject) === normalized).map((relation) => relation.workspaceId))
    const confirmed = workspaces.filter((workspace) => confirmedIds.has(workspace.id)).map((workspace) => this.candidate(workspace, 1, 'A matéria foi confirmada anteriormente neste contexto acadêmico.', 'confirmed_context'))
    if (confirmed.length === 1) return { status: 'resolved', candidate: confirmed[0]! }
    if (confirmed.length > 1) return { status: 'ambiguous', candidates: confirmed }

    if (!policy.allowSemantic || !this.dependencies.suggestSemantic) return { status: 'none', candidates: [] }
    const contextByWorkspace = new Map<string, string[]>()
    for (const relation of relations) contextByWorkspace.set(relation.workspaceId, [...(contextByWorkspace.get(relation.workspaceId) ?? []), relation.subject])
    const allowed = policy.semanticWorkspaceIds ? new Set(policy.semanticWorkspaceIds) : null
    const semanticWorkspaces = workspaces.filter((workspace) => !allowed || allowed.has(workspace.id))
    if (!semanticWorkspaces.length) return { status: 'none', candidates: [] }
    const suggestions = await this.dependencies.suggestSemantic({ subject: subject.trim(), workspaces: semanticWorkspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, contextSubjects: contextByWorkspace.get(workspace.id) ?? [] })) })
    const candidates = suggestions.filter((suggestion) => suggestion.confidence >= 0.65).flatMap((suggestion) => { const workspace = workspaces.find((item) => item.id === suggestion.workspaceId); return workspace ? [this.candidate(workspace, Math.min(0.99, suggestion.confidence), suggestion.reason, 'semantic')] : [] }).sort((a, b) => b.confidence - a.confidence)
    if (candidates.length === 0) return { status: 'none', candidates: [] }
    if (candidates.length > 1) return { status: 'ambiguous', candidates }
    return { status: 'suggested', candidate: candidates[0]! }
  }

  private candidate(workspace: Workspace, confidence: number, reason: string, tier: SubjectWorkspaceCandidate['tier']): SubjectWorkspaceCandidate {
    return { workspaceId: workspace.id, workspaceName: workspace.name, confidence, reason: reason.trim().slice(0, 300), tier }
  }
}
