CREATE TABLE `concepts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`level` integer NOT NULL,
	`order` integer NOT NULL,
	`body_md` text NOT NULL,
	`analogy` text,
	`example` text,
	`seen_in_brief_id` integer,
	FOREIGN KEY (`seen_in_brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concepts_slug_unique` ON `concepts` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `concepts_order_unique` ON `concepts` (`order`);