-- Competitive Bingo — initial schema.
-- Forward-only and safe to re-run: every statement is IF NOT EXISTS.
--
-- Invariants the rest of the system leans on:
--   * account_hash is TEXT, always. It is a signed 64-bit value that exceeds 2^53 and is
--     silently corrupted by JSON.parse. It is never stored, compared or returned as a number.
--   * events is append-only. No UPDATE, no DELETE, ever.
--   * Every derived table (metric_state, tile_progress) must be reconstructible by replaying
--     events in received_at order. That replay is a real, tested function.

CREATE TABLE IF NOT EXISTS games (
  id                    TEXT PRIMARY KEY,
  name                  TEXT    NOT NULL,
  join_code             TEXT    NOT NULL UNIQUE,
  -- CLASSIC: every team works the same board independently.
  -- CONTROL: teams compete for each tile and ownership flips as they overtake each other.
  -- RUSH:    the first team to complete a tile takes it, and it never changes hands.
  mode                  TEXT    NOT NULL CHECK (mode IN ('CLASSIC', 'CONTROL', 'RUSH')),
  -- Required for CONTROL. NULL for CLASSIC, which is decided on final score, and for RUSH, whose
  -- rule is fixed. Enforced in application code, which can give a better message than a CHECK.
  win_condition         TEXT             CHECK (win_condition IN ('FIRST_LINE', 'MOST_AT_DEADLINE', 'HYBRID_SUDDEN_DEATH')),
  -- SUDDEN_DEATH is an internal state, never sent to the plugin: the contract game state enum
  -- is UPCOMING|LIVE|ENDED|LOCKED and adding to it is a schema version bump.
  -- GET /api/plugin/game reports SUDDEN_DEATH as LIVE, because events must keep counting.
  state                 TEXT    NOT NULL CHECK (state IN ('UPCOMING', 'LIVE', 'ENDED', 'LOCKED', 'SUDDEN_DEATH')),
  starts_at             INTEGER NOT NULL,
  ends_at               INTEGER NOT NULL,
  board_rows            INTEGER NOT NULL,
  board_cols            INTEGER NOT NULL,
  screenshots_requested INTEGER NOT NULL DEFAULT 1 CHECK (screenshots_requested IN (0, 1)),
  backfill_policy       TEXT    NOT NULL CHECK (backfill_policy IN ('COUNT', 'IGNORE', 'FLAG_ONLY')),
  -- Set when a win is decided, so the result survives eviction of the Durable Object.
  won_by_team_id        TEXT,
  won_at                INTEGER,
  created_at            INTEGER NOT NULL
);

-- The metric IDs a game tracks, exactly as GET /api/plugin/game advertises them. A row is
-- either an exact metric ID or one of the only two permitted wildcards.
CREATE TABLE IF NOT EXISTS game_metrics (
  game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  metric_id TEXT NOT NULL,
  label     TEXT,
  PRIMARY KEY (game_id, metric_id)
);

CREATE TABLE IF NOT EXISTS teams (
  id      TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  colour  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teams_game ON teams(game_id);

CREATE TABLE IF NOT EXISTS players (
  id              TEXT PRIMARY KEY,
  game_id         TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  account_hash    TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  -- NULL is legitimate and is not an error: a player may sync before an admin has built the
  -- roster. Their events are stored with team_id NULL and retroactively attributed on
  -- assignment. Only removed_at produces a 403.
  team_id         TEXT REFERENCES teams(id) ON DELETE SET NULL,
  removed_at      INTEGER,
  first_synced_at INTEGER NOT NULL,
  last_synced_at  INTEGER NOT NULL,
  UNIQUE (game_id, account_hash)
);
CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_id);
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);

-- RSN history. Hiscores are keyed on display name, not account hash, so reconciliation needs
-- to fall back through previous names on a 404.
CREATE TABLE IF NOT EXISTS player_names (
  player_id    TEXT    NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  display_name TEXT    NOT NULL,
  seen_at      INTEGER NOT NULL,
  PRIMARY KEY (player_id, display_name)
);

CREATE TABLE IF NOT EXISTS tiles (
  id               TEXT    PRIMARY KEY,
  game_id          TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  row_index        INTEGER NOT NULL,
  col_index        INTEGER NOT NULL,
  label            TEXT    NOT NULL,
  -- { metrics: string[], aggregate: 'SUM'|'UNIQUE'|'MIN_DURATION', target: number|null }
  requirement_json TEXT    NOT NULL,
  -- Denormalised from requirement_json for cheap reads. NULL for MIN_DURATION.
  target           INTEGER,
  UNIQUE (game_id, row_index, col_index)
);
CREATE INDEX IF NOT EXISTS idx_tiles_game ON tiles(game_id);

-- Append-only. The durable record of every fact any plugin ever reported.
CREATE TABLE IF NOT EXISTS events (
  game_id           TEXT    NOT NULL,
  event_id          TEXT    NOT NULL,
  player_id         TEXT    NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- The team at the time of receipt. NULL when the player was unassigned, backfilled when an
  -- admin assigns them. That backfill is the one permitted write to an existing row.
  team_id           TEXT    REFERENCES teams(id) ON DELETE SET NULL,
  metric_id         TEXT    NOT NULL,
  -- MANUAL is a synthetic type for admin credit/discredit, so replay stays correct. It never
  -- appears on the wire.
  metric_type       TEXT    NOT NULL CHECK (metric_type IN ('COUNT', 'KILL', 'DROP', 'DURATION', 'COLLECTION_LOG', 'MANUAL')),
  value             INTEGER,
  delta             INTEGER,
  -- The increment the server derived and actually credited, after backfill policy.
  credited          INTEGER NOT NULL DEFAULT 0,
  -- The full increment implied by value - last_value, before backfill policy trimmed it.
  -- Always recorded even when none of it was credited.
  derived_delta     INTEGER,
  first_observation INTEGER NOT NULL DEFAULT 0 CHECK (first_observation IN (0, 1)),
  detail_json       TEXT    NOT NULL,
  session_id        TEXT,
  client_time       INTEGER,
  -- Server receipt time. The only clock trusted for anything that decides an outcome, and the
  -- ordering key replay depends on.
  received_at       INTEGER NOT NULL,
  screenshot_key    TEXT,
  PRIMARY KEY (game_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_events_replay ON events(game_id, received_at);
CREATE INDEX IF NOT EXISTS idx_events_player ON events(game_id, player_id, received_at);
CREATE INDEX IF NOT EXISTS idx_events_metric ON events(game_id, metric_id);

-- Last absolute value seen per (game, player, metric), for deriving authoritative deltas.
-- Derived: rebuildable from events.
CREATE TABLE IF NOT EXISTS metric_state (
  game_id      TEXT    NOT NULL,
  player_id    TEXT    NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  metric_id    TEXT    NOT NULL,
  last_value   INTEGER,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id, metric_id)
);

-- Derived: rebuildable from events.
CREATE TABLE IF NOT EXISTS tile_progress (
  game_id          TEXT    NOT NULL,
  tile_id          TEXT    NOT NULL REFERENCES tiles(id) ON DELETE CASCADE,
  team_id          TEXT    NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  score            INTEGER NOT NULL DEFAULT 0,
  best_duration_ms INTEGER,
  -- Receipt time of the event that set the current best, so MIN_DURATION ties break on who
  -- got there first.
  best_at          INTEGER,
  complete         INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  owner_since      INTEGER,
  PRIMARY KEY (game_id, tile_id, team_id)
);

CREATE TABLE IF NOT EXISTS flags (
  id          TEXT    PRIMARY KEY,
  game_id     TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  event_id    TEXT,
  player_id   TEXT    NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN (
                'MONOTONIC_DECREASE', 'BACKFILL', 'IMPLAUSIBLE_RATE', 'CLOCK_SKEW',
                'HASH_MISMATCH', 'NOT_READY', 'IMPLAUSIBLE_DURATION', 'HISCORE_DISCREPANCY')),
  detail_json TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  resolution  TEXT    CHECK (resolution IN ('CREDITED', 'DISCREDITED', 'DISMISSED')),
  resolved_by TEXT,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_flags_open ON flags(game_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_flags_player ON flags(game_id, player_id);

CREATE TABLE IF NOT EXISTS readiness (
  player_id   TEXT    PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  ready       INTEGER NOT NULL CHECK (ready IN (0, 1)),
  checks_json TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id          TEXT    PRIMARY KEY,
  game_id     TEXT    REFERENCES games(id) ON DELETE CASCADE,
  actor       TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  detail_json TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_game ON admin_actions(game_id, created_at);

-- Login throttling. There is one password and no user accounts, so this is the only thing
-- standing between a public URL and an offline guessing run.
CREATE TABLE IF NOT EXISTS login_attempts (
  client_key   TEXT    PRIMARY KEY,
  failures     INTEGER NOT NULL DEFAULT 0,
  first_failed INTEGER NOT NULL,
  locked_until INTEGER
);
