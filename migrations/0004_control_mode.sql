-- CONTROL mode: tile ownership, and the record of how a game finished.

-- Who currently holds each tile. Derived: rebuildable from tile_progress, which is itself
-- rebuildable from the event log.
--
-- Ownership is a property of the tile rather than of a team, which is why it is not a column on
-- tile_progress: a tile has exactly one owner, or none.
CREATE TABLE IF NOT EXISTS tile_ownership (
  game_id       TEXT    NOT NULL,
  tile_id       TEXT    NOT NULL REFERENCES tiles(id) ON DELETE CASCADE,
  -- NULL when nobody leads: either no team has scored on it, or the leaders are level.
  owner_team_id TEXT    REFERENCES teams(id) ON DELETE SET NULL,
  -- 1 when two or more teams are level at the top. A contested tile is owned by nobody, but it
  -- is a different thing from a tile nobody has touched, and the board shows it differently.
  contested     INTEGER NOT NULL DEFAULT 0 CHECK (contested IN (0, 1)),
  -- When the current owner took it. Sniping is intended, so this is display, not protection.
  since         INTEGER,
  PRIMARY KEY (game_id, tile_id)
);
CREATE INDEX IF NOT EXISTS idx_tile_ownership_game ON tile_ownership(game_id);

-- The board as it stood when the game ended, so a finished event still renders after the live
-- object has gone away.
CREATE TABLE IF NOT EXISTS board_snapshots (
  game_id       TEXT    PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  snapshot_json TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);
