-- Hand-typed events and value-range drop metrics.

-- Whether this event was observed by the plugin or typed in by a player.
--
-- Worth keeping on the row rather than inferring from the detail shape: it is the difference
-- between a fact a parser saw and a figure somebody asserted, and that difference is the whole
-- reason manual entries get reviewed.
ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'OBSERVED';

-- Whether players may submit events by hand at all.
--
-- The plugin hides the control when this is false, but that is a convenience rather than a
-- defence — the contract is explicit that a server which does not want hand-typed events must
-- reject them on ingest, which is what this column drives.
ALTER TABLE games ADD COLUMN manual_entry_allowed INTEGER NOT NULL DEFAULT 1
  CHECK (manual_entry_allowed IN (0, 1));

-- "Any drop worth a million or more" cannot be written as a metric ID, because an ID is derived
-- from an item's name and says nothing about what it is worth. A rule names the metric to emit
-- and the band of coin value that earns it; the plugin does the pricing and the comparison.
CREATE TABLE IF NOT EXISTS drop_value_rules (
  game_id   TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  metric_id TEXT    NOT NULL,
  label     TEXT,
  min_value INTEGER,
  max_value INTEGER,
  -- Null means GRAND_EXCHANGE, per the contract's defaults.
  valuation TEXT    CHECK (valuation IN ('GRAND_EXCHANGE', 'HIGH_ALCHEMY')),
  -- Null means ITEMS. VALUE makes the event's delta the coin value of the stack.
  counts    TEXT    CHECK (counts IN ('ITEMS', 'VALUE')),
  PRIMARY KEY (game_id, metric_id)
);
