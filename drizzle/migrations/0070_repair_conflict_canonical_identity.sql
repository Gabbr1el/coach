ALTER TABLE `workspace_repair_conflicts` ADD `canonical_workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
UPDATE `workspace_repair_conflicts`
SET `canonical_workspace_id` = (
  SELECT w.`id`
  FROM `workspaces` w
  WHERE w.`equivalence_key` = `workspace_repair_conflicts`.`equivalence_key`
  ORDER BY
    CASE WHEN w.`status` = 'active' AND w.`confirmed_at` IS NOT NULL THEN 0 ELSE 1 END,
    CASE WHEN w.`status` = 'completed' THEN 0 ELSE 1 END,
    COALESCE(w.`last_opened_at`, -1) DESC,
    w.`created_at` ASC,
    w.`id` ASC
  LIMIT 1
)
WHERE `canonical_workspace_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `workspace_repair_conflicts_canonical_idx` ON `workspace_repair_conflicts` (`canonical_workspace_id`);
