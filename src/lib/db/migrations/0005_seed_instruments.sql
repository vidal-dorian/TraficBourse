-- Default tracked universe (CLAUDE.md §6). Yahoo symbols: verify each against Yahoo Finance
-- before deploying (the job logs an error per symbol Yahoo does not know).
INSERT OR IGNORE INTO `instruments` (`symbol`, `provider_symbol`, `name`, `type`, `exchange`, `currency`, `in_watchlist`) VALUES
	('^FCHI', '^FCHI', 'CAC 40', 'index', 'Euronext Paris', 'EUR', 0),
	('^STOXX50E', '^STOXX50E', 'Euro Stoxx 50', 'index', NULL, 'EUR', 0),
	('^GSPC', '^GSPC', 'S&P 500', 'index', NULL, 'USD', 0),
	('^NDX', '^NDX', 'Nasdaq 100', 'index', NULL, 'USD', 0),
	('IWDA.AS', 'IWDA.AS', 'iShares Core MSCI World UCITS ETF (Acc)', 'etf', 'Euronext Amsterdam', 'EUR', 0),
	('EURUSD=X', 'EURUSD=X', 'EUR/USD', 'fx', NULL, 'USD', 0),
	('GC=F', 'GC=F', 'Or', 'commodity', NULL, 'USD', 0),
	('BZ=F', 'BZ=F', 'Pétrole Brent', 'commodity', NULL, 'USD', 0),
	('BTC-EUR', 'BTC-EUR', 'Bitcoin', 'crypto', NULL, 'EUR', 0);
