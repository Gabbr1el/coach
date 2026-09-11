CREATE TABLE `performance_timeline_events` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_id` text NOT NULL,
  `operation_type` text NOT NULL,
  `workspace_id` text,
  `stage` text NOT NULL,
  `wall_time` integer NOT NULL,
  `elapsed_ms` integer NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `performance_timeline_operation_idx` ON `performance_timeline_events` (`operation_id`,`elapsed_ms`);
--> statement-breakpoint
CREATE INDEX `performance_timeline_type_time_idx` ON `performance_timeline_events` (`operation_type`,`wall_time`);
--> statement-breakpoint
CREATE TABLE `material_analysis_cache` (
  `analysis_fingerprint` text PRIMARY KEY NOT NULL,
  `content_hash` text NOT NULL,
  `extraction_fingerprint` text NOT NULL,
  `parser_revision` text NOT NULL,
  `schema_revision` text NOT NULL,
  `role_context_hash` text NOT NULL,
  `analysis_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `last_used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `material_analysis_cache_lookup_idx` ON `material_analysis_cache` (`content_hash`,`parser_revision`,`schema_revision`,`role_context_hash`);
