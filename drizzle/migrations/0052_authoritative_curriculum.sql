ALTER TABLE `roadmap_modules` ADD `curricular_topics_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `concepts` ADD `stable_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `concepts_workspace_domain_key_unique` ON `concepts` (`workspace_id`,`domain`,`stable_key`);
--> statement-breakpoint
ALTER TABLE `assessment_intents` ADD `stable_key` text;
--> statement-breakpoint
ALTER TABLE `assessment_intents` ADD `evidence_type` text;
--> statement-breakpoint
ALTER TABLE `assessment_intents` ADD `difficulty` text;
--> statement-breakpoint
ALTER TABLE `assessment_intents` ADD `prerequisite_concept_ids_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_intents_workspace_key_unique` ON `assessment_intents` (`workspace_id`,`stable_key`);
--> statement-breakpoint
ALTER TABLE `exercises` ADD `assessment_intent_key` text;
--> statement-breakpoint
ALTER TABLE `exercises` ADD `concept_keys_json` text NOT NULL DEFAULT '[]';
