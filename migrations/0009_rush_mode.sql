-- RUSH mode: the first team to complete a tile takes it, and keeps it.
--
-- The mode itself needed no migration. Allowing a third value in the `games.mode` CHECK would
-- have meant rebuilding that table, and `games` is a parent to almost everything with several
-- children ON DELETE CASCADE — in D1 the implicit DELETE behind DROP TABLE fires those cascades
-- and takes the database with it. `PRAGMA defer_foreign_keys` does not save you: it only applies
-- inside a transaction, and the migration runner does not provide one. Since this schema has
-- never been deployed, the CHECK in 0001 was widened in place instead.
--
-- What is left is the one thing RUSH genuinely needs storing.

-- When a team first satisfied a tile's requirement.
--
-- CONTROL settles ownership by comparing current standings, so it needs no history. RUSH cannot:
-- "who got there first" is not recoverable from the final scores, and a replay rebuilds tile
-- progress from nothing. Storing the moment keeps the claim a pure function of tile_progress,
-- which is what makes a replay agree with live scoring.
ALTER TABLE tile_progress ADD COLUMN completed_at INTEGER;
