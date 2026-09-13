ALTER TABLE `study_plan_items` ADD `exercise_set_id` text;
--> statement-breakpoint
ALTER TABLE `study_plan_items` ADD `material_id` text;
--> statement-breakpoint
CREATE INDEX `study_plan_items_exercise_set_idx` ON `study_plan_items` (`exercise_set_id`);
--> statement-breakpoint
CREATE INDEX `study_plan_items_material_idx` ON `study_plan_items` (`material_id`);
