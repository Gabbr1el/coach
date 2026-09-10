CREATE TABLE `roadmap_rebuild_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`current_roadmap_id` text NOT NULL,
	`proposal_json` text NOT NULL,
	`material_ids_json` text NOT NULL,
	`impact_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_roadmap_id`) REFERENCES `roadmaps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `roadmap_rebuild_previews_workspace_idx` ON `roadmap_rebuild_previews` (`workspace_id`,`created_at`);
