ALTER TABLE `academic_subject_contexts` ADD `observed_strengths_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `academic_subject_contexts` ADD `observed_difficulties_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `academic_subject_contexts` ADD `misconceptions_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `academic_subject_contexts` ADD `mastered_concepts_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `academic_subject_contexts` ADD `review_concepts_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `academic_subject_contexts` ADD `last_consolidated_at` integer;
