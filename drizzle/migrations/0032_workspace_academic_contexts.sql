CREATE TABLE `workspace_academic_contexts` (
	`workspace_id` text NOT NULL,
	`subject` text NOT NULL,
	`relation` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `subject`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`subject`) REFERENCES `academic_subject_contexts`(`subject`) ON DELETE cascade,
	CONSTRAINT "workspace_academic_contexts_relation_check" CHECK(`relation` in ('primary','implementation_language','prerequisite','user_selected'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_academic_contexts_one_primary` ON `workspace_academic_contexts` (`workspace_id`) WHERE `relation` = 'primary';--> statement-breakpoint
INSERT OR IGNORE INTO `academic_subject_contexts` (`subject`, `declared_level`, `declared_knowledge_json`, `declared_difficulties_json`, `goals_json`, `source_evidence_json`, `created_at`, `updated_at`)
SELECT `name`, NULL, '[]', '[]', '[]', '[]', `created_at`, `updated_at` FROM `workspaces`;--> statement-breakpoint
INSERT OR IGNORE INTO `workspace_academic_contexts` (`workspace_id`, `subject`, `relation`)
SELECT `id`, `name`, 'primary' FROM `workspaces`;
