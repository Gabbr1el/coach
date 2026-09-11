import { studyLessonBlockSchema, studyLessonContentSchema, studyPresentationPreferencesSchema, type NewStudyLessonAdaptation, type PersistedStudyLesson, type StudyLessonAdaptation, type StudyLessonBlock, type StudyPresentationPreferences } from '../../shared/contracts/study-lesson-contract'
import { assertPresentationOnlyAdaptation, type StudyLessonRepository } from '../../application/study-lessons/study-lesson-service'
import type { CoachDatabase } from '../database/connection'

type LessonRow = { id: string; generationKind: PersistedStudyLesson['generationKind']; workspaceId: string; roadmapId: string; moduleId: string; topicId: string; contentJson: string; providerId: string | null; modelId: string | null; createdAt: number }
type AdaptationRow = { id: string; workspaceId: string; lessonId: string; blockId: string; revision: number; reason: string; mode: StudyLessonAdaptation['mode']; adaptedBlockJson: string; isActive: number; providerId: string | null; modelId: string | null; createdAt: number }

function mapLesson(row: LessonRow): PersistedStudyLesson {
  return { ...studyLessonContentSchema.parse(JSON.parse(row.contentJson)), id: row.id, generationKind: row.generationKind, workspaceId: row.workspaceId, roadmapId: row.roadmapId, moduleId: row.moduleId, topicId: row.topicId, providerId: row.providerId, modelId: row.modelId, createdAt: row.createdAt }
}

function originalBlock(content: PersistedStudyLesson, blockId: string): StudyLessonBlock {
  const block = content.blocks.find((item) => item.id === blockId)
  if (!block) throw new Error('Study lesson block not found')
  return block
}

function mapAdaptation(row: AdaptationRow, base: PersistedStudyLesson): StudyLessonAdaptation {
  const original = originalBlock(base, row.blockId)
  const adapted = studyLessonBlockSchema.parse(JSON.parse(row.adaptedBlockJson))
  assertPresentationOnlyAdaptation(original, adapted)
  return { id: row.id, workspaceId: row.workspaceId, lessonId: row.lessonId, blockId: row.blockId, revision: row.revision, reason: row.reason, mode: row.mode, originalBlock: original, adaptedBlock: adapted, isActive: row.isActive === 1, providerId: row.providerId, modelId: row.modelId, createdAt: row.createdAt }
}

function isCompositionBoundary(block: StudyLessonBlock): boolean { return block.type === 'checkpoint' || block.type === 'interactiveCode' || block.type === 'miniExercise' }

export function composeAdaptedLessonBlocks(baseBlocks: StudyLessonBlock[], adaptations: StudyLessonAdaptation[]): StudyLessonBlock[] {
  const active = adaptations.filter((item) => item.isActive)
  const overlays = new Map(active.map((item) => [item.blockId, item.adaptedBlock]))
  const blocks = baseBlocks.map((block) => overlays.get(block.id) ?? block)
  for (const adaptation of active.sort((left, right) => left.createdAt - right.createdAt)) {
    if (adaptation.mode !== 'CODE_FIRST' && adaptation.mode !== 'REORDER') continue
    const sourceIndex = blocks.findIndex((block) => block.id === adaptation.blockId)
    if (sourceIndex < 0 || isCompositionBoundary(blocks[sourceIndex]!)) continue
    let segmentStart = sourceIndex
    while (segmentStart > 0 && !isCompositionBoundary(blocks[segmentStart - 1]!)) segmentStart -= 1
    let segmentEnd = sourceIndex
    while (segmentEnd + 1 < blocks.length && !isCompositionBoundary(blocks[segmentEnd + 1]!)) segmentEnd += 1
    const movingIndex = adaptation.mode === 'CODE_FIRST'
      ? (blocks[sourceIndex]!.type === 'codeExample' ? sourceIndex : blocks.findIndex((block, index) => index >= segmentStart && index <= segmentEnd && block.type === 'codeExample'))
      : sourceIndex
    const targetIndex = adaptation.mode === 'CODE_FIRST' ? segmentStart : Math.max(segmentStart, sourceIndex - 1)
    if (movingIndex < segmentStart || movingIndex === targetIndex) continue
    const [moving] = blocks.splice(movingIndex, 1)
    blocks.splice(targetIndex, 0, moving!)
  }
  return blocks
}

const lessonColumns = 'id, generation_kind AS generationKind, workspace_id AS workspaceId, roadmap_id AS roadmapId, module_id AS moduleId, topic_id AS topicId, content_json AS contentJson, provider_id AS providerId, model_id AS modelId, created_at AS createdAt'
const adaptationColumns = 'id, workspace_id AS workspaceId, lesson_id AS lessonId, source_block_id AS blockId, revision, reason, mode, adapted_block_json AS adaptedBlockJson, is_active AS isActive, provider_id AS providerId, model_id AS modelId, created_at AS createdAt'

export class SqliteStudyLessonRepository implements StudyLessonRepository {
  constructor(private readonly database: CoachDatabase) {}

  private findBase(roadmapId: string, topicId: string): PersistedStudyLesson | null {
    const row = this.database.sqlite.prepare(`SELECT ${lessonColumns} FROM study_lessons WHERE roadmap_id = ? AND topic_id = ?`).get(roadmapId, topicId) as LessonRow | undefined
    if (!row) return null
    try { return mapLesson(row) }
    catch {
      this.database.sqlite.prepare('DELETE FROM study_lesson_adaptations WHERE lesson_id = ?').run(row.id)
      this.database.sqlite.prepare('DELETE FROM study_lessons WHERE id = ?').run(row.id)
      return null
    }
  }

  private findBaseById(lessonId: string): PersistedStudyLesson | null {
    const row = this.database.sqlite.prepare(`SELECT ${lessonColumns} FROM study_lessons WHERE id = ?`).get(lessonId) as LessonRow | undefined
    return row ? mapLesson(row) : null
  }

  private activeAdaptations(base: PersistedStudyLesson): StudyLessonAdaptation[] {
    const rows = this.database.sqlite.prepare(`SELECT ${adaptationColumns} FROM study_lesson_adaptations WHERE lesson_id = ? AND is_active = 1 ORDER BY created_at, revision`).all(base.id) as AdaptationRow[]
    const valid: StudyLessonAdaptation[] = []
    for (const row of rows) {
      try { valid.push(mapAdaptation(row, base)) }
      catch { continue }
    }
    return valid
  }

  findOriginal(roadmapId: string, topicId: string): PersistedStudyLesson | null { return this.findBase(roadmapId, topicId) }

  find(roadmapId: string, topicId: string): PersistedStudyLesson | null {
    const base = this.findBase(roadmapId, topicId)
    if (!base) return null
    const active = this.activeAdaptations(base)
    if (!active.length) return base
    return { ...base, blocks: composeAdaptedLessonBlocks(base.blocks, active) }
  }

  create(lesson: PersistedStudyLesson): PersistedStudyLesson {
    this.database.sqlite.prepare('INSERT OR IGNORE INTO study_lessons (id, workspace_id, roadmap_id, module_id, topic_id, generation_kind, content_json, provider_id, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(lesson.id, lesson.workspaceId, lesson.roadmapId, lesson.moduleId, lesson.topicId, lesson.generationKind, JSON.stringify({ title: lesson.title, level: lesson.level, objective: lesson.objective, blocks: lesson.blocks, sources: lesson.sources }), lesson.providerId, lesson.modelId, lesson.createdAt, lesson.createdAt)
    const persisted = this.findBase(lesson.roadmapId, lesson.topicId)
    if (!persisted || persisted.workspaceId !== lesson.workspaceId || persisted.moduleId !== lesson.moduleId || persisted.topicId !== lesson.topicId) throw new Error('Study lesson persistence verification failed')
    return persisted
  }

  replace(lesson: PersistedStudyLesson): PersistedStudyLesson {
    const base = this.findBase(lesson.roadmapId, lesson.topicId)
    const baseBlocks = base ? new Map(base.blocks.map((block) => [block.id, block])) : null
    const contentBlocks = baseBlocks ? lesson.blocks.map((block) => baseBlocks.get(block.id) ?? block) : lesson.blocks
    this.database.sqlite.prepare('UPDATE study_lessons SET workspace_id = ?, module_id = ?, generation_kind = ?, content_json = ?, provider_id = ?, model_id = ?, updated_at = ? WHERE roadmap_id = ? AND topic_id = ?').run(lesson.workspaceId, lesson.moduleId, lesson.generationKind, JSON.stringify({ title: lesson.title, level: lesson.level, objective: lesson.objective, blocks: contentBlocks, sources: lesson.sources }), lesson.providerId, lesson.modelId, Date.now(), lesson.roadmapId, lesson.topicId)
    const persisted = this.findBase(lesson.roadmapId, lesson.topicId)
    if (!persisted || persisted.workspaceId !== lesson.workspaceId || persisted.moduleId !== lesson.moduleId || persisted.topicId !== lesson.topicId) throw new Error('Study lesson persistence verification failed')
    return persisted
  }

  setContentRevision(lessonId: string, revision: number, inputHash: string): void { this.database.sqlite.prepare('UPDATE study_lessons SET content_revision=?,input_hash=? WHERE id=?').run(revision, inputHash, lessonId) }

  createAdaptation(value: NewStudyLessonAdaptation, signal?: AbortSignal): StudyLessonAdaptation {
    return this.database.sqlite.transaction(() => {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
      const base = this.findBaseById(value.lessonId)
      if (!base || base.workspaceId !== value.workspaceId) throw new Error('Study lesson not found')
      const original = originalBlock(base, value.blockId)
      assertPresentationOnlyAdaptation(original, value.adaptedBlock)
      const revision = (this.database.sqlite.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM study_lesson_adaptations WHERE lesson_id = ? AND source_block_id = ?').get(value.lessonId, value.blockId) as { revision: number }).revision + 1
      this.database.sqlite.prepare('UPDATE study_lesson_adaptations SET is_active = 0 WHERE lesson_id = ? AND source_block_id = ? AND is_active = 1').run(value.lessonId, value.blockId)
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
      this.database.sqlite.prepare('INSERT INTO study_lesson_adaptations (id, workspace_id, lesson_id, source_block_id, revision, reason, mode, adapted_block_json, is_active, provider_id, model_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)').run(value.id, value.workspaceId, value.lessonId, value.blockId, revision, value.reason, value.mode, JSON.stringify(value.adaptedBlock), value.providerId, value.modelId, value.createdAt)
      return { ...value, revision, originalBlock: original, isActive: true }
    })()
  }

  listAdaptations(lessonId: string, blockId: string): StudyLessonAdaptation[] {
    const base = this.findBaseById(lessonId)
    if (!base) return []
    const rows = this.database.sqlite.prepare(`SELECT ${adaptationColumns} FROM study_lesson_adaptations WHERE lesson_id = ? AND source_block_id = ? ORDER BY revision DESC`).all(lessonId, blockId) as AdaptationRow[]
    return rows.flatMap((row) => { try { return [mapAdaptation(row, base)] } catch { return [] } })
  }

  restoreOriginal(lessonId: string, blockId: string): PersistedStudyLesson {
    return this.database.sqlite.transaction(() => {
      const base = this.findBaseById(lessonId)
      if (!base) throw new Error('Study lesson not found')
      originalBlock(base, blockId)
      this.database.sqlite.prepare('UPDATE study_lesson_adaptations SET is_active = 0 WHERE lesson_id = ? AND source_block_id = ? AND is_active = 1').run(lessonId, blockId)
      return this.find(base.roadmapId, base.topicId) ?? base
    })()
  }

  activateAdaptation(lessonId: string, blockId: string, adaptationId: string): PersistedStudyLesson {
    return this.database.sqlite.transaction(() => {
      const base = this.findBaseById(lessonId)
      if (!base) throw new Error('Study lesson not found')
      const target = this.database.sqlite.prepare('SELECT id FROM study_lesson_adaptations WHERE id = ? AND lesson_id = ? AND source_block_id = ?').get(adaptationId, lessonId, blockId)
      if (!target) throw new Error('Study lesson adaptation not found')
      this.database.sqlite.prepare('UPDATE study_lesson_adaptations SET is_active = 0 WHERE lesson_id = ? AND source_block_id = ? AND is_active = 1').run(lessonId, blockId)
      this.database.sqlite.prepare('UPDATE study_lesson_adaptations SET is_active = 1 WHERE id = ?').run(adaptationId)
      return this.find(base.roadmapId, base.topicId) ?? base
    })()
  }

  getPreferences(workspaceId: string): StudyPresentationPreferences { const row = this.database.sqlite.prepare('SELECT preferences_json AS value FROM workspace_study_preferences WHERE workspace_id = ?').get(workspaceId) as { value: string } | undefined; return studyPresentationPreferencesSchema.parse(row ? JSON.parse(row.value) : {}) }
  setPreferences(workspaceId: string, preferences: StudyPresentationPreferences, updatedAt: number): StudyPresentationPreferences { const parsed = studyPresentationPreferencesSchema.parse(preferences); this.database.sqlite.prepare('INSERT INTO workspace_study_preferences (workspace_id, preferences_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET preferences_json=excluded.preferences_json, updated_at=excluded.updated_at').run(workspaceId, JSON.stringify(parsed), updatedAt); return parsed }
}
