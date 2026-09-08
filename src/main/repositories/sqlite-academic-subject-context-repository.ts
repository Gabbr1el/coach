import type { AcademicSubjectContextRepository } from '../../application/workspaces/academic-subject-context'
import type { AcademicSubjectContext, AcademicSubjectDeclaration } from '../../shared/contracts/academic-subject-context-contract'
import type { CoachDatabase } from '../database/connection'

type Row = { subject: string; declaredLevel: AcademicSubjectContext['declaredLevel']; declaredKnowledgeJson: string; declaredDifficultiesJson: string; goalsJson: string; sourceEvidenceJson: string; createdAt: number; updatedAt: number }
const columns = 'subject, declared_level AS declaredLevel, declared_knowledge_json AS declaredKnowledgeJson, declared_difficulties_json AS declaredDifficultiesJson, goals_json AS goalsJson, source_evidence_json AS sourceEvidenceJson, created_at AS createdAt, updated_at AS updatedAt'
function map(row: Row): AcademicSubjectContext { return { subject: row.subject, declaredLevel: row.declaredLevel, declaredKnowledge: JSON.parse(row.declaredKnowledgeJson), declaredDifficulties: JSON.parse(row.declaredDifficultiesJson), goals: JSON.parse(row.goalsJson), sourceEvidence: JSON.parse(row.sourceEvidenceJson), createdAt: row.createdAt, updatedAt: row.updatedAt } }

export class SqliteAcademicSubjectContextRepository implements AcademicSubjectContextRepository {
  constructor(private readonly database: CoachDatabase) {}
  find(subject: string): AcademicSubjectContext | null { const row = this.database.sqlite.prepare(`SELECT ${columns} FROM academic_subject_contexts WHERE subject = ?`).get(subject) as Row | undefined; return row ? map(row) : null }
  upsert(input: AcademicSubjectDeclaration, now: number): AcademicSubjectContext {
    this.database.sqlite.prepare('INSERT INTO academic_subject_contexts (subject, declared_level, declared_knowledge_json, declared_difficulties_json, goals_json, source_evidence_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(subject) DO UPDATE SET declared_level=excluded.declared_level, declared_knowledge_json=excluded.declared_knowledge_json, declared_difficulties_json=excluded.declared_difficulties_json, goals_json=excluded.goals_json, source_evidence_json=excluded.source_evidence_json, updated_at=excluded.updated_at').run(input.subject, input.declaredLevel ?? null, JSON.stringify(input.declaredKnowledge), JSON.stringify(input.declaredDifficulties), JSON.stringify(input.goals), JSON.stringify(input.sourceEvidence), now, now)
    return this.find(input.subject)!
  }
}
