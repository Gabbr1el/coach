CREATE TABLE IF NOT EXISTS `workspace_repair_conflicts` (
  `equivalence_key` text PRIMARY KEY NOT NULL,
  `workspace_ids_json` text NOT NULL,
  `evidence_workspace_ids_json` text NOT NULL,
  `reason` text NOT NULL,
  `detected_at` integer NOT NULL,
  `resolved_at` integer,
  CONSTRAINT `workspace_repair_conflicts_reason_check` CHECK (`reason` IN ('multiple_meaningful_evidence'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `workspace_repair_conflicts_resolution_idx` ON `workspace_repair_conflicts` (`resolved_at`,`detected_at`);
--> statement-breakpoint
DROP TABLE IF EXISTS `_workspace_repair_facts`;
--> statement-breakpoint
WITH RECURSIVE normalized(`id`,`rest`,`value`) AS (
  SELECT `id`,lower(`name`),'' FROM `workspaces` WHERE `meaningful_distinction` IS NULL
  UNION ALL
  SELECT `id`,substr(`rest`,2),`value` || CASE
    WHEN substr(`rest`,1,1) IN ('Á','À','Â','Ã','Ä','á','à','â','ã','ä') THEN 'a'
    WHEN substr(`rest`,1,1) IN ('É','Ê','é','ê') THEN 'e'
    WHEN substr(`rest`,1,1) IN ('Í','í') THEN 'i'
    WHEN substr(`rest`,1,1) IN ('Ó','Ò','Ô','Õ','Ö','ó','ò','ô','õ','ö') THEN 'o'
    WHEN substr(`rest`,1,1) IN ('Ú','Ù','Û','Ü','ú','ù','û','ü') THEN 'u'
    WHEN substr(`rest`,1,1) IN ('Ç','ç') THEN 'c'
    WHEN substr(`rest`,1,1) BETWEEN 'a' AND 'z' OR substr(`rest`,1,1) BETWEEN '0' AND '9' OR substr(`rest`,1,1) IN ('+','#') THEN substr(`rest`,1,1)
    WHEN length(`value`)>0 AND substr(`value`,-1)<>' ' THEN ' ' ELSE '' END
  FROM normalized WHERE length(`rest`)>0
), keys AS (SELECT `id`,trim(`value`) AS `plain` FROM normalized WHERE `rest`='')
UPDATE `workspaces` SET `equivalence_key`=(SELECT CASE
  WHEN `plain` IN ('poo','programacao orientada a objetos','orientacao a objetos') THEN 'programacao-orientada-a-objetos'
  WHEN `plain` LIKE 'poo %' THEN 'programacao-orientada-a-objetos-' || replace(substr(`plain`,5),' ','-')
  WHEN `plain` LIKE 'programacao orientada a objetos %' THEN 'programacao-orientada-a-objetos-' || replace(substr(`plain`,33),' ','-')
  WHEN `plain` LIKE 'orientacao a objetos %' THEN 'programacao-orientada-a-objetos-' || replace(substr(`plain`,22),' ','-')
  WHEN `plain` IN ('js','javascript','java script') THEN 'javascript'
  WHEN `plain` LIKE 'js %' THEN 'javascript-' || replace(substr(`plain`,4),' ','-')
  WHEN `plain` LIKE 'javascript %' THEN 'javascript-' || replace(substr(`plain`,12),' ','-')
  WHEN `plain` LIKE 'java script %' THEN 'javascript-' || replace(substr(`plain`,13),' ','-')
  ELSE replace(`plain`,' ','-') END FROM keys WHERE keys.`id`=`workspaces`.`id`)
WHERE `meaningful_distinction` IS NULL;
--> statement-breakpoint
CREATE TEMP TABLE `_workspace_repair_facts` AS
SELECT
  w.`id` AS `workspace_id`,
  w.`equivalence_key`,
  w.`status`,
  w.`created_at`,
  w.`updated_at`,
  w.`last_opened_at`,
  CASE WHEN
    EXISTS (SELECT 1 FROM `learning_attempts` x WHERE x.`workspace_id`=w.`id`) OR
    EXISTS (SELECT 1 FROM `study_progress_events` x WHERE x.`workspace_id`=w.`id`) OR
    EXISTS (SELECT 1 FROM `topic_learning_states` x WHERE x.`workspace_id`=w.`id` AND (x.`evidence_count`>0 OR x.`assessments`>0 OR x.`exercises_completed`>0 OR x.`lessons_completed`>0)) OR
    EXISTS (SELECT 1 FROM `checkpoint_reasoning_evidence` x WHERE x.`workspace_id`=w.`id`) OR
    EXISTS (SELECT 1 FROM `exercise_attempts` x WHERE x.`workspace_id`=w.`id`)
  THEN 1 ELSE 0 END AS `learning_evidence`,
  CASE WHEN
    EXISTS (SELECT 1 FROM `learning_attempts` x WHERE x.`workspace_id`=w.`id`) OR
    EXISTS (SELECT 1 FROM `study_progress_events` x WHERE x.`workspace_id`=w.`id`) OR
    EXISTS (SELECT 1 FROM `topic_learning_states` x WHERE x.`workspace_id`=w.`id` AND (x.`evidence_count`>0 OR x.`assessments`>0 OR x.`exercises_completed`>0 OR x.`lessons_completed`>0)) OR
    EXISTS (SELECT 1 FROM `checkpoint_reasoning_evidence` x WHERE x.`workspace_id`=w.`id`) OR
    EXISTS (SELECT 1 FROM `exercise_attempts` x WHERE x.`workspace_id`=w.`id`) OR
    EXISTS (SELECT 1 FROM `exercise_progress` x WHERE x.`workspace_id`=w.`id` AND (x.`attempts`>0 OR x.`status`<>'not_started' OR length(trim(x.`current_code`))>0)) OR
    EXISTS (SELECT 1 FROM `conversation_threads` t JOIN `conversation_messages` m ON m.`thread_id`=t.`id` WHERE t.`workspace_id`=w.`id` AND m.`role`='user' AND length(trim(m.`content`))>0) OR
    EXISTS (SELECT 1 FROM `workspace_study_states` x WHERE x.`workspace_id`=w.`id` AND (x.`document_revision`>0 OR x.`notes_revision`>0 OR x.`accumulated_focus_seconds`>0 OR length(trim(x.`editor_content`))>0 OR length(trim(x.`notes`))>0)) OR
    EXISTS (SELECT 1 FROM `study_sessions` x WHERE x.`workspace_id`=w.`id` AND (x.`status`='completed' OR x.`focus_seconds`>0)) OR
    EXISTS (SELECT 1 FROM `materials` x WHERE x.`workspace_id`=w.`id`) OR
    EXISTS (SELECT 1 FROM `project_files` f JOIN `workspace_projects` p ON p.`id`=f.`project_id` WHERE p.`workspace_id`=w.`id` AND (f.`revision`>0 OR length(trim(f.`content`))>0)) OR
    EXISTS (SELECT 1 FROM `weekly_plan_items` x WHERE x.`workspace_id`=w.`id` AND x.`status`='completed') OR
    EXISTS (SELECT 1 FROM `study_plan_items` x WHERE x.`workspace_id`=w.`id` AND x.`status`='completed')
  THEN 1 ELSE 0 END AS `meaningful_evidence`,
  CASE WHEN
    EXISTS (SELECT 1 FROM `workspace_content_revisions` x WHERE x.`workspace_id`=w.`id` AND x.`state` IN ('usable','fully_provisioned')) OR
    EXISTS (SELECT 1 FROM `workspace_provisioning` x WHERE x.`workspace_id`=w.`id` AND x.`status`='ready')
  THEN 1 ELSE 0 END AS `usable`,
  (
    (SELECT count(*)*10000 FROM `roadmaps` r WHERE r.`workspace_id`=w.`id` AND r.`status`='accepted') +
    (SELECT count(*)*100 FROM `roadmap_modules` m JOIN `roadmaps` r ON r.`id`=m.`roadmap_id` WHERE r.`workspace_id`=w.`id` AND r.`status`='accepted') +
    (SELECT COALESCE(sum(json_array_length(m.`topics_json`)),0)*10 FROM `roadmap_modules` m JOIN `roadmaps` r ON r.`id`=m.`roadmap_id` WHERE r.`workspace_id`=w.`id` AND r.`status`='accepted') +
    (SELECT count(*) FROM `study_lessons` x WHERE x.`workspace_id`=w.`id`) +
    (SELECT count(*) FROM `exercise_sets` x WHERE x.`workspace_id`=w.`id` AND x.`status`='ready')
  ) AS `generated_completeness`
FROM `workspaces` w
WHERE w.`status`='active';
--> statement-breakpoint
DROP TABLE IF EXISTS `_workspace_repair_rank`;
--> statement-breakpoint
CREATE TEMP TABLE `_workspace_repair_rank` AS
SELECT
  f.*,
  count(*) OVER (PARTITION BY f.`equivalence_key`) AS `equivalent_count`,
  sum(CASE WHEN f.`status`='active' THEN 1 ELSE 0 END) OVER (PARTITION BY f.`equivalence_key`) AS `active_count`,
  sum(f.`meaningful_evidence`) OVER (PARTITION BY f.`equivalence_key`) AS `evidence_count`,
  row_number() OVER (
    PARTITION BY f.`equivalence_key`
    ORDER BY f.`usable` DESC, f.`learning_evidence` DESC, f.`generated_completeness` DESC,
      COALESCE(f.`last_opened_at`,-1) DESC, f.`created_at` ASC, f.`workspace_id` ASC
  ) AS `canonical_rank`
FROM `_workspace_repair_facts` f;
--> statement-breakpoint
INSERT INTO `workspace_repair_conflicts` (`equivalence_key`,`workspace_ids_json`,`evidence_workspace_ids_json`,`reason`,`detected_at`,`resolved_at`)
SELECT
  r.`equivalence_key`,
  (SELECT json_group_array(x.`workspace_id`) FROM (SELECT `workspace_id` FROM `_workspace_repair_rank` WHERE `equivalence_key`=r.`equivalence_key` ORDER BY `workspace_id`) x),
  (SELECT json_group_array(x.`workspace_id`) FROM (SELECT `workspace_id` FROM `_workspace_repair_rank` WHERE `equivalence_key`=r.`equivalence_key` AND `meaningful_evidence`=1 ORDER BY `workspace_id`) x),
  'multiple_meaningful_evidence',
  min(r.`created_at`),
  NULL
FROM `_workspace_repair_rank` r
GROUP BY r.`equivalence_key`
HAVING sum(r.`meaningful_evidence`)>1
ON CONFLICT(`equivalence_key`) DO UPDATE SET
  `workspace_ids_json`=excluded.`workspace_ids_json`,
  `evidence_workspace_ids_json`=excluded.`evidence_workspace_ids_json`,
  `reason`=excluded.`reason`,
  `resolved_at`=NULL;
--> statement-breakpoint
UPDATE `workspaces`
SET `status`='archived', `archived_at`=COALESCE(`archived_at`,`updated_at`), `completed_at`=NULL
WHERE `id` IN (
  SELECT `workspace_id` FROM `_workspace_repair_rank`
  WHERE `evidence_count`>1 AND `canonical_rank`>1
);
--> statement-breakpoint
UPDATE `workspaces`
SET `status`='archived', `archived_at`=COALESCE(`archived_at`,`updated_at`), `completed_at`=NULL
WHERE `id` IN (
  SELECT `workspace_id` FROM `_workspace_repair_rank`
  WHERE `equivalent_count`>1 AND `canonical_rank`>1 AND `meaningful_evidence`=0
);
--> statement-breakpoint
UPDATE `workspaces`
SET `status`='archived', `archived_at`=COALESCE(`archived_at`,`updated_at`), `completed_at`=NULL
WHERE `id` IN (
  SELECT `workspace_id` FROM `_workspace_repair_rank` r
  WHERE r.`status`='active' AND r.`equivalent_count`>1 AND r.`evidence_count`=0
    AND NOT EXISTS (SELECT 1 FROM `_workspace_repair_rank` x WHERE x.`equivalence_key`=r.`equivalence_key` AND (x.`usable`=1 OR x.`generated_completeness`>0))
);
--> statement-breakpoint
UPDATE `workspaces`
SET `status`='archived', `archived_at`=COALESCE(`archived_at`,`updated_at`), `completed_at`=NULL
WHERE `id` IN (
  SELECT active.`workspace_id` FROM `_workspace_repair_rank` active
  JOIN `_workspace_repair_rank` canonical ON canonical.`equivalence_key`=active.`equivalence_key` AND canonical.`canonical_rank`=1
  WHERE active.`status`='active' AND active.`workspace_id`<>canonical.`workspace_id`
    AND active.`meaningful_evidence`=0 AND active.`evidence_count`<=1
    AND (canonical.`usable`=1 OR canonical.`meaningful_evidence`=1 OR canonical.`generated_completeness`>0)
);
--> statement-breakpoint
UPDATE `workspaces`
SET `status`='active', `archived_at`=NULL, `completed_at`=NULL
WHERE `id` IN (
  SELECT `workspace_id` FROM `_workspace_repair_rank`
  WHERE `canonical_rank`=1 AND `active_count`>0 AND `evidence_count`<=1
    AND (`usable`=1 OR `meaningful_evidence`=1 OR `generated_completeness`>0)
    AND (`status`='active' OR NOT EXISTS (
      SELECT 1 FROM `_workspace_repair_rank` active_evidence
      WHERE active_evidence.`equivalence_key`=`_workspace_repair_rank`.`equivalence_key`
        AND active_evidence.`status`='active' AND active_evidence.`meaningful_evidence`=1
    ))
);
--> statement-breakpoint
UPDATE `workspace_provisioning`
SET
  `status`=CASE
    WHEN EXISTS (
      SELECT 1 FROM `_workspace_repair_rank` r
      WHERE r.`workspace_id`=`workspace_provisioning`.`workspace_id` AND (r.`usable`=1 OR r.`meaningful_evidence`=1)
    ) THEN 'ready'
    ELSE 'queued'
  END,
  `stage`=CASE
    WHEN EXISTS (
      SELECT 1 FROM `_workspace_repair_rank` r
      WHERE r.`workspace_id`=`workspace_provisioning`.`workspace_id` AND (r.`usable`=1 OR r.`meaningful_evidence`=1)
    ) THEN 'ready'
    ELSE 'workspace'
  END,
  `started_at`=COALESCE(`started_at`,`stage_updated_at`,`created_at`),
  `completed_at`=CASE
    WHEN EXISTS (
      SELECT 1 FROM `_workspace_repair_rank` r
      WHERE r.`workspace_id`=`workspace_provisioning`.`workspace_id` AND (r.`usable`=1 OR r.`meaningful_evidence`=1)
    ) THEN COALESCE(`completed_at`,`stage_updated_at`,`created_at`)
    ELSE NULL
  END,
  `retry_after`=NULL,
  `error_code`=NULL,
  `error_message`=NULL
WHERE `status`='draft' AND `workspace_id` IN (
  SELECT r.`workspace_id` FROM `_workspace_repair_rank` r
  JOIN `workspaces` w ON w.`id`=r.`workspace_id`
  WHERE r.`canonical_rank`=1 AND w.`status`='active'
    AND (r.`usable`=1 OR r.`meaningful_evidence`=1 OR r.`generated_completeness`>0)
);
--> statement-breakpoint
INSERT INTO `workspace_content_revisions` (`workspace_id`,`revision`,`input_hash`,`state`,`cancellation_generation`,`created_at`,`updated_at`,`usable_at`,`legacy_state`)
SELECT r.`workspace_id`,1,'legacy-unavailable','provisioning',0,r.`created_at`,r.`updated_at`,r.`updated_at`,'legacy_accessible'
FROM `_workspace_repair_rank` r
JOIN `workspaces` w ON w.`id`=r.`workspace_id`
WHERE r.`canonical_rank`=1 AND r.`meaningful_evidence`=1 AND w.`status`='active'
  AND NOT EXISTS (SELECT 1 FROM `workspace_content_revisions` existing WHERE existing.`workspace_id`=r.`workspace_id`)
ON CONFLICT(`workspace_id`) DO NOTHING;
--> statement-breakpoint
UPDATE `workspace_content_revisions`
SET `legacy_state`='legacy_accessible', `usable_at`=COALESCE(`usable_at`,`updated_at`)
WHERE `workspace_id` IN (
  SELECT r.`workspace_id` FROM `_workspace_repair_rank` r
  JOIN `workspaces` w ON w.`id`=r.`workspace_id`
  WHERE r.`canonical_rank`=1 AND r.`meaningful_evidence`=1 AND w.`status`='active'
);
--> statement-breakpoint
UPDATE `workspaces`
SET `confirmed_at`=COALESCE(`confirmed_at`,`created_at`)
WHERE `status`='active'
  AND NOT EXISTS (SELECT 1 FROM `workspace_provisioning` p WHERE p.`workspace_id`=`workspaces`.`id` AND p.`status`='draft')
  AND NOT EXISTS (
    SELECT 1 FROM `workspaces` other
    WHERE other.`id`<>`workspaces`.`id` AND other.`status`='active'
      AND other.`equivalence_key`=`workspaces`.`equivalence_key`
  );
--> statement-breakpoint
DELETE FROM `weekly_plan_items`
WHERE `status`<>'completed' AND NOT EXISTS (SELECT 1 FROM `workspaces` w WHERE w.`id`=`weekly_plan_items`.`workspace_id` AND w.`status`='active');
--> statement-breakpoint
DELETE FROM `study_plan_items`
WHERE `status`<>'completed' AND NOT EXISTS (SELECT 1 FROM `workspaces` w WHERE w.`id`=`study_plan_items`.`workspace_id` AND w.`status`='active');
--> statement-breakpoint
DROP TABLE IF EXISTS `_workspace_repair_rank`;
--> statement-breakpoint
DROP TABLE IF EXISTS `_workspace_repair_facts`;
