CREATE TABLE `weekly_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `week_start` text NOT NULL,
  `timezone` text NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `generated_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_plans_week_timezone_idx` ON `weekly_plans` (`week_start`,`timezone`);
--> statement-breakpoint
CREATE TABLE `weekly_plan_items` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_id` text NOT NULL,
  `workspace_id` text NOT NULL,
  `source_key` text NOT NULL,
  `date_key` text NOT NULL,
  `title` text NOT NULL,
  `duration_minutes` integer NOT NULL,
  `position` integer NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `module_id` text,
  `topic_id` text,
  `activity_type` text NOT NULL,
  `scheduled_start_minutes` integer NOT NULL,
  `reason` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`plan_id`) REFERENCES `weekly_plans`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `weekly_plan_items_duration_check` CHECK(`duration_minutes` between 1 and 480),
  CONSTRAINT `weekly_plan_items_status_check` CHECK(`status` in ('pending','in_progress','completed')),
  CONSTRAINT `weekly_plan_items_activity_check` CHECK(`activity_type` in ('introduction','review','exercise'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_plan_items_source_idx` ON `weekly_plan_items` (`plan_id`,`source_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_plan_items_position_idx` ON `weekly_plan_items` (`plan_id`,`date_key`,`position`);
--> statement-breakpoint
CREATE INDEX `weekly_plan_items_workspace_date_idx` ON `weekly_plan_items` (`workspace_id`,`date_key`);
