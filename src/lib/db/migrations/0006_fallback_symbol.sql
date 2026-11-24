ALTER TABLE `instruments` ADD `fallback_symbol` text;--> statement-breakpoint
-- Twelve Data symbols (free tier: US stocks and ETFs, forex, crypto) of the default instruments
-- it covers; indices, the Euronext ETF and futures stay NULL (not on the free tier).
UPDATE `instruments` SET `fallback_symbol` = 'EUR/USD' WHERE `symbol` = 'EURUSD=X';
--> statement-breakpoint
UPDATE `instruments` SET `fallback_symbol` = 'BTC/EUR' WHERE `symbol` = 'BTC-EUR';
