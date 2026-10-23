-- Provenance fields carried on every envelope.
--
-- game_tick is not optional detail: recomputing an eventId needs accountHash, sessionId,
-- metricId, gameTick and the type-specific values. Without the tick, a stored event can never be
-- re-verified against its own ID during an audit or a replay.
--
-- world and world_types exist because [D4] deliberately allows FRESH_START_WORLD and leaves the
-- judgement to the server: "the server sees worldTypes on every envelope and can decide for
-- itself". It cannot decide anything it did not keep.
--
-- SQLite ALTER TABLE ADD COLUMN has no IF NOT EXISTS, so re-running this migration is guarded by
-- D1's own migration bookkeeping rather than by the statement.

ALTER TABLE events ADD COLUMN game_tick INTEGER;
ALTER TABLE events ADD COLUMN world INTEGER;
ALTER TABLE events ADD COLUMN world_types TEXT;
