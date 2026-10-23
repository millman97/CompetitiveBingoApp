-- Makes `events` hold only what was reported, and nothing the server worked out.
--
-- Four columns move out. Each of them was something the server computed or attached afterwards,
-- which meant a row had to be rewritten after it was written:
--
--   team_id        an admin assigning a team retroactively attributes prior events (spec 3.3)
--   screenshot_key evidence arrives on a separate request that may fail (spec 3.6)
--   credited       recomputed from scratch by a replay
--   derived_delta  likewise
--
-- Team is now derived by joining players.team_id at scoring time, which makes retroactive
-- attribution free and automatically correct — assigning a team re-attributes that player's
-- history by definition, with no rows rewritten. The rest live in derived tables that the replay
-- function owns and is free to rebuild.
--
-- What remains in `events` is the raw fact: what the plugin said, when the server received it.
-- Every derived table below is reconstructible from it by replaying in received_at order.

-- Evidence for an event. Separate because an upload is a later, independent, failure-prone act.
CREATE TABLE IF NOT EXISTS event_screenshots (
  game_id     TEXT    NOT NULL,
  event_id    TEXT    NOT NULL,
  object_key  TEXT    NOT NULL,
  media_type  TEXT    NOT NULL,
  uploaded_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, event_id)
);

-- What the server decided this event was worth. Derived: rebuildable from events.
CREATE TABLE IF NOT EXISTS event_credit (
  game_id       TEXT    NOT NULL,
  event_id      TEXT    NOT NULL,
  -- The increment actually credited, after the game's backfill policy.
  credited      INTEGER NOT NULL,
  -- The full increment implied by value - last_value, before the policy trimmed it. Recorded in
  -- every case, even when none of it was credited, so a dispute can see what was withheld.
  derived_delta INTEGER,
  PRIMARY KEY (game_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_event_credit_game ON event_credit(game_id);

-- Per-metric plausibility ceilings and floors. Rows here override the shipped defaults; a game
-- with no row for a metric uses the default. Editable from the admin panel.
CREATE TABLE IF NOT EXISTS metric_thresholds (
  game_id            TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  metric_id          TEXT NOT NULL,
  -- COUNT only. Credited increments per minute above which IMPLAUSIBLE_RATE is flagged.
  max_per_minute     INTEGER,
  -- DURATION only. A run faster than this is flagged as IMPLAUSIBLE_DURATION.
  min_duration_ms    INTEGER,
  PRIMARY KEY (game_id, metric_id)
);

-- Carry across anything the previous shape already held.
INSERT INTO event_screenshots (game_id, event_id, object_key, media_type, uploaded_at)
SELECT game_id, event_id, screenshot_key, 'image/jpeg', received_at
FROM events
WHERE screenshot_key IS NOT NULL;

ALTER TABLE events DROP COLUMN team_id;
ALTER TABLE events DROP COLUMN screenshot_key;
ALTER TABLE events DROP COLUMN credited;
ALTER TABLE events DROP COLUMN derived_delta;
