CREATE TABLE `workspace_terminal_memory` (
  `workspace_id` text PRIMARY KEY NOT NULL REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
  `consolidated_at` integer NOT NULL
);
