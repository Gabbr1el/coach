DROP INDEX IF EXISTS `workspaces_active_equivalence_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_confirmed_active_equivalence_unique` ON `workspaces` (`equivalence_key`) WHERE `status`='active' AND `confirmed_at` IS NOT NULL;
