# Value-based drop tiles

In a tile's **Metrics**, choose **Drop value**, then one of:

- **Drops above a value:** counts qualifying loot stacks. Set a target count,
  inclusive minimum/optional maximum in gp, and GE or high-alchemy pricing.
  Ten items in one qualifying stack count as one stack.
- **Most valuable drop:** uses the highest qualifying stack value in gp.
  Smaller drops do not accumulate; optional bounds restrict qualifying stacks.

A tile uses one metric category and one value option at a time. Selecting a
metric from another category replaces the current metrics and scoring type.

Prices and stack boundaries come from the player's recorded observation, without
a live market-price lookup. Missing or zero prices do not count.

## Game modes

- **Control:** the highest score holds the tile; equal leading scores contest it.
- **Classic:** a highest-value tile completes after any positive qualifying record.
- **Rush:** a highest-value tile goes to the first qualifying stack.

Admin adjustments use stacks for drop counts and gp for highest-value records.

## Changing rules

The board and its generated plugin tracking rules save together. Changing a
filter creates a new tracking metric: players must Sync, and the tile starts
fresh tracking. Earlier observations remain in event history. Changing between
count and highest value with the same filter reuses the recorded value history.

Existing custom rules remain available in **Advanced drop-value rules**.
