CREATE TABLE IF NOT EXISTS games (
  name_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'searching',
  created_at TEXT NOT NULL,
  checked_at TEXT,
  searched_at TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  codes_json TEXT NOT NULL DEFAULT '[]',
  error TEXT
);
CREATE TABLE IF NOT EXISTS quota_usage (
  month_key TEXT PRIMARY KEY,
  credits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ip_daily_searches (
  ip_day_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
