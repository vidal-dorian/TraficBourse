CREATE TABLE `instruments` (
	`symbol` text PRIMARY KEY NOT NULL,
	`provider_symbol` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`exchange` text,
	`currency` text NOT NULL,
	`in_watchlist` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prices_daily` (
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`open` real,
	`high` real,
	`low` real,
	`close` real NOT NULL,
	`volume` integer,
	PRIMARY KEY(`symbol`, `date`),
	FOREIGN KEY (`symbol`) REFERENCES `instruments`(`symbol`) ON UPDATE no action ON DELETE cascade
);
