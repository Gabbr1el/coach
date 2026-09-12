CREATE TABLE `planning_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `timezone` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `planning_settings` (`id`,`timezone`,`updated_at`)
SELECT 'current', `timezone`, `generated_at` FROM `weekly_plans` ORDER BY `generated_at` DESC, rowid DESC LIMIT 1;
--> statement-breakpoint
CREATE TABLE `workspace_content_authority` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `mutation_fingerprint` text DEFAULT 'none' NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE CASCADE
);
