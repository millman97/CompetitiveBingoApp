-- The end time, expressed relative to the start.
--
-- NULL means the organiser pinned the deadline to a wall-clock time and it stays there. A number
-- means the deadline follows the start: pushing a game back a day carries its end with it, rather
-- than being refused for ending before it begins.
--
-- ends_at is still the only thing anything reads. This column decides what happens to it when the
-- start moves, and nothing else.

ALTER TABLE games ADD COLUMN end_offset_ms INTEGER;

-- Every existing game was created from a duration, so that is what its end goes back to being.
UPDATE games SET end_offset_ms = ends_at - starts_at;
