ALTER TABLE `roadmap_rebuild_previews` ADD `status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE `roadmap_rebuild_previews` ADD `applied_roadmap_id` text REFERENCES roadmaps(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `roadmap_rebuild_previews` ADD `resolved_at` integer;
--> statement-breakpoint
CREATE INDEX `roadmap_rebuild_previews_status_idx` ON `roadmap_rebuild_previews` (`workspace_id`,`status`,`created_at`);
