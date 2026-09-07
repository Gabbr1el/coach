ALTER TABLE `roadmap_modules` ADD `topics_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `roadmap_modules` ADD `practice` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `roadmap_modules` ADD `completion_criteria_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `roadmap_modules` ADD `resources_json` text DEFAULT '[]' NOT NULL;