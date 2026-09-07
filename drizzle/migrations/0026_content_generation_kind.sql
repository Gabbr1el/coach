ALTER TABLE `roadmaps` ADD `generation_kind` text DEFAULT 'provisional_fallback' NOT NULL;
--> statement-breakpoint
ALTER TABLE `study_lessons` ADD `generation_kind` text DEFAULT 'provisional_fallback' NOT NULL;
