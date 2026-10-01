-- Run once on the existing bloxcode-radar D1 database.
ALTER TABLE games ADD COLUMN search_count INTEGER NOT NULL DEFAULT 0;
