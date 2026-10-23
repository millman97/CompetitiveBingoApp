-- When this game's tracked metrics last changed.
--
-- The plugin does not poll, so a metric added mid-game is not observed by any player until they
-- next sync — silently. Recording when the board's metric list changed lets the admin screen name
-- exactly who has not re-synced since, which is the difference between a warning an organiser can
-- act on and one they discover afterwards.
ALTER TABLE games ADD COLUMN metrics_changed_at INTEGER;
