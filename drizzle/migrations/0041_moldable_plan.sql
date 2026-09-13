CREATE TABLE `daily_planning_budgets` (
  `date_key` text NOT NULL,
  `timezone` text NOT NULL,
  `minutes` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`date_key`, `timezone`),
  CONSTRAINT `daily_planning_budgets_minutes_check` CHECK(`minutes` between 0 and 1440)
);
--> statement-breakpoint
CREATE TABLE `plan_item_completion_history` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL,
  `workspace_id` text NOT NULL,
  `completed` integer NOT NULL,
  `duration_minutes` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`item_id`) REFERENCES `weekly_plan_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `plan_item_completion_history_completed_check` CHECK(`completed` in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `plan_item_completion_history_item_idx` ON `plan_item_completion_history` (`item_id`,`created_at`);
