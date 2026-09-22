export function usableWorkspaceSql(alias = 'w'): string {
  return `${alias}.status='active'
    AND ${alias}.confirmed_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM workspace_provisioning draft
      WHERE draft.workspace_id=${alias}.id AND draft.status='draft'
    )
    AND (
      EXISTS (
        SELECT 1 FROM workspace_content_revisions readiness
        WHERE readiness.workspace_id=${alias}.id
          AND (readiness.state IN ('usable','fully_provisioned') OR readiness.legacy_state='legacy_accessible')
      )
      OR (
        NOT EXISTS (SELECT 1 FROM workspace_provisioning lifecycle WHERE lifecycle.workspace_id=${alias}.id)
        AND (
          EXISTS (SELECT 1 FROM roadmaps legacy_roadmap WHERE legacy_roadmap.workspace_id=${alias}.id AND legacy_roadmap.status='accepted')
          OR EXISTS (SELECT 1 FROM study_sessions legacy_session WHERE legacy_session.workspace_id=${alias}.id)
          OR EXISTS (SELECT 1 FROM study_progress_events legacy_progress WHERE legacy_progress.workspace_id=${alias}.id)
          OR EXISTS (SELECT 1 FROM learning_attempts legacy_attempt WHERE legacy_attempt.workspace_id=${alias}.id)
          OR EXISTS (SELECT 1 FROM topic_learning_states legacy_learning WHERE legacy_learning.workspace_id=${alias}.id AND legacy_learning.evidence_count>0)
          OR EXISTS (SELECT 1 FROM concept_memories legacy_memory WHERE legacy_memory.workspace_id=${alias}.id)
          OR EXISTS (SELECT 1 FROM study_deadlines legacy_deadline WHERE legacy_deadline.workspace_id=${alias}.id)
          OR EXISTS (SELECT 1 FROM academic_events legacy_event WHERE legacy_event.workspace_id=${alias}.id)
          OR EXISTS (SELECT 1 FROM academic_life_items legacy_life WHERE legacy_life.workspace_id=${alias}.id)
          OR EXISTS (SELECT 1 FROM materials legacy_material WHERE legacy_material.workspace_id=${alias}.id)
          OR EXISTS (SELECT 1 FROM workspace_projects legacy_project WHERE legacy_project.workspace_id=${alias}.id)
        )
      )
    )`
}
