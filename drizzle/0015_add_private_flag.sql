ALTER TABLE `packages` ADD `is_private` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `is_private` integer DEFAULT false NOT NULL;