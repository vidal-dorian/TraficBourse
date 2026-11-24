CREATE TABLE `stock_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brief_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`reason` text NOT NULL,
	`summary` text NOT NULL,
	`news_refs` text NOT NULL,
	`next_event` text,
	FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE cascade
);
