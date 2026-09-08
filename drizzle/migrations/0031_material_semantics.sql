ALTER TABLE `materials` ADD `role` text DEFAULT 'reference' NOT NULL;
--> statement-breakpoint
ALTER TABLE `materials` ADD `semantic_analysis_json` text;
