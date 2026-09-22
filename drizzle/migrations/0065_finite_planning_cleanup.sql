DELETE FROM `weekly_plan_items`
WHERE `status` <> 'completed'
  AND (
    NOT EXISTS (
      SELECT 1 FROM `workspaces` w
      WHERE w.`id` = `weekly_plan_items`.`workspace_id`
        AND w.`status` = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM `roadmap_modules` m, json_each(m.`topics_json`) topic
      JOIN `roadmaps` r ON r.`id` = m.`roadmap_id`
      LEFT JOIN `study_progress` p ON p.`workspace_id` = r.`workspace_id`
      WHERE r.`workspace_id` = `weekly_plan_items`.`workspace_id`
        AND r.`status` = 'accepted'
        AND `weekly_plan_items`.`topic_id` = m.`id` || ':' || topic.`value`
        AND json_extract(
          COALESCE(p.`topic_statuses_json`, '{}'),
          printf('$."%s"', replace(m.`id` || ':' || topic.`value`, '"', '\"'))
        ) = 'COMPLETED'
    )
  );
--> statement-breakpoint
DELETE FROM `study_plan_items`
WHERE `status` <> 'completed'
  AND (
    NOT EXISTS (
      SELECT 1 FROM `workspaces` w
      WHERE w.`id` = `study_plan_items`.`workspace_id`
        AND w.`status` = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM `roadmap_modules` m, json_each(m.`topics_json`) topic
      JOIN `roadmaps` r ON r.`id` = m.`roadmap_id`
      LEFT JOIN `study_progress` p ON p.`workspace_id` = r.`workspace_id`
      WHERE r.`workspace_id` = `study_plan_items`.`workspace_id`
        AND r.`status` = 'accepted'
        AND `study_plan_items`.`topic_id` = m.`id` || ':' || topic.`value`
        AND json_extract(
          COALESCE(p.`topic_statuses_json`, '{}'),
          printf('$."%s"', replace(m.`id` || ':' || topic.`value`, '"', '\"'))
        ) = 'COMPLETED'
    )
  );
