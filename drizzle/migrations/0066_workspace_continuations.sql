CREATE TABLE `workspace_continuation_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `predecessor_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
  `suggested_name` text NOT NULL,
  `objective` text NOT NULL,
  `rationale` text NOT NULL,
  `equivalence_key` text NOT NULL,
  `context_json` text DEFAULT '[]' NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `successor_id` text REFERENCES `workspaces`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `resolved_at` integer,
  CONSTRAINT `workspace_continuation_status_check` CHECK (`status` IN ('pending','accepted','declined'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_continuation_predecessor_unique` ON `workspace_continuation_decisions` (`predecessor_id`);
--> statement-breakpoint
CREATE INDEX `workspace_continuation_equivalence_idx` ON `workspace_continuation_decisions` (`equivalence_key`,`status`);
