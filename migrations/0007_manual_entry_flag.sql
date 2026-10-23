-- A flag kind for hand-typed events.
--
-- Every manual entry is flagged for review, because it is the one event kind whose contents a
-- player chose: the plugin vouches for the screenshot and for nothing else. That is not an
-- accusation, it is the same "record it, flag it, let a person judge" rule everything else here
-- follows — it just applies to all of them rather than to the suspicious ones.
--
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt. Existing flags and their
-- resolutions are carried across.

CREATE TABLE flags_new (
  id          TEXT    PRIMARY KEY,
  game_id     TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  event_id    TEXT,
  player_id   TEXT    NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN (
                'MONOTONIC_DECREASE', 'BACKFILL', 'IMPLAUSIBLE_RATE', 'CLOCK_SKEW',
                'HASH_MISMATCH', 'NOT_READY', 'IMPLAUSIBLE_DURATION', 'HISCORE_DISCREPANCY',
                'MANUAL_ENTRY')),
  detail_json TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  resolution  TEXT    CHECK (resolution IN ('CREDITED', 'DISCREDITED', 'DISMISSED')),
  resolved_by TEXT,
  resolved_at INTEGER
);

INSERT INTO flags_new (id, game_id, event_id, player_id, kind, detail_json, created_at,
                       resolution, resolved_by, resolved_at)
SELECT id, game_id, event_id, player_id, kind, detail_json, created_at,
       resolution, resolved_by, resolved_at
FROM flags;

DROP TABLE flags;
ALTER TABLE flags_new RENAME TO flags;

CREATE INDEX IF NOT EXISTS idx_flags_open ON flags(game_id, resolved_at);
