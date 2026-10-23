# Architecture

See the [README](../README.md) for setup and [development](development.md) for
commands and coding conventions.

## Runtime

| Component                   | Responsibility                                                     |
| --------------------------- | ------------------------------------------------------------------ |
| Cloudflare Worker and Hono  | HTTP routes, authentication and the React app's static assets      |
| D1                          | Events, players, teams, boards, derived scores and admin history   |
| One Durable Object per game | Serialised scoring, ownership, win detection and WebSocket updates |
| R2                          | Screenshot evidence                                                |
| React and TanStack Query    | Organiser screens, public boards and cached server state           |

SQLite-backed Durable Objects use hibernating WebSockets. Persistent state lives
in storage so objects can sleep between requests. One alarm handles the event
deadline and broadcast scheduling.

## Plugin contract

`contract/` contains the API document, schemas and version record vendored from
the RuneLite plugin. Keep them unchanged here; update them with
`npm run vendor:contract` when adopting a plugin contract change.

`npm run generate` produces types and standalone Ajv validators in ignored
`src/generated/`. Precompilation avoids runtime code generation in Workers.
`src/contract/envelope.ts` adds the event type/detail discriminated union.

Important protocol rules:

- Account hashes remain decimal strings; JavaScript numbers cannot represent
  every account hash exactly.
- Deduplication uses `(gameId, eventId)`.
- Duration values are milliseconds in `value`, with `delta` null; lower is better.
- Delta-only drops and log slots rely on retry deduplication. Missing observations
  can be supplied manually or corrected by an organiser.
- Batch responses report per-event outcomes, including when HTTP status is 200.
- The server sends the blocked world types; an empty list blocks nothing.

## Event processing and replay

The Worker authenticates and validates a batch before handing it to the game's
Durable Object. The object stores observations, derives credit, settles tiles and
ownership, detects wins, then broadcasts updates. Replay and admin scoring changes
use the same serialised path. Duplicate retries can finish settlement after a
partially completed request.

The `events` log is append-only. Derived state can be rebuilt:

| Table            | Derived state                                     |
| ---------------- | ------------------------------------------------- |
| `event_credit`   | Credit after backfill policy and review decisions |
| `metric_state`   | Last absolute count per player and metric         |
| `tile_progress`  | Team scores and completion times                  |
| `tile_ownership` | Tile holders and contested state                  |

Replay processes events by `received_at`, then rowid, preserving the order within
a batch. Existing flag resolutions survive replay. Admin adjustments are recorded
as synthetic manual events so rebuilding preserves them.

Team scores use players' current team assignments. Moving a player therefore
reattributes their contributions without rewriting their observations.

## Scoring and review

Count events are differenced against stored baselines. A decreasing count earns
nothing and does not lower its baseline. Drops, collection-log slots and NPC
kills are delta-based; duration tiles read the reported time directly.

Manual submissions never change observed-count baselines and are always flagged
for review. Flags alone do not reject observations or alter scores. Structural
rejections follow the plugin contract: untracked metrics, non-live games,
out-of-window observations and invalid events.

Control ownership follows the leading score, with ties contested. Rush claims use
the first qualifying completion time, then team ID as a deterministic tiebreak.
Replaying discredited evidence can therefore change a Rush claim. In Rush, a
time tile goes to the first reported run. See [value tiles](value-tiles.md) for
the corresponding drop-value rules.

## Event setup and frontend

Creation saves the schedule, teams and complete board atomically. Validation
rejects empty/out-of-bounds tiles, impossible requirements, fewer than two teams
and invalid schedules. Browser drafts are saved locally until creation succeeds.
Relative deadlines move with the start; absolute deadlines stay fixed.

Routes distinguish the public event list and board from session-protected admin
screens. Public summaries omit join codes and moderation data. The initial board
snapshot and WebSocket patches share one query cache; polling provides a fallback.
Activity is fetched separately with pagination.

Fonts and game icons are served locally. Their source and licence notices remain
in [fonts](../public/fonts/NOTICE.md) and [artwork](../public/images/osrs/NOTICE.md).
