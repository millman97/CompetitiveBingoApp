# Competitive Bingo — plugin/server API contract

Status: draft 6. Every question raised against draft 1 is resolved; see
[section 11](#11-changelog).
Schema version: 1
Plugin version this document describes: 0.1.0

This document is the interface between the RuneLite plugin in this repository and the bingo
server built separately. It is written from the plugin's side: everything below is either
something the plugin sends, something it requires of a response, or a behaviour the server
may rely on the plugin exhibiting.

Decisions that shaped this document, and the reasoning behind each, are recorded in
[section 11](#11-decision-record). They are referenced inline as [Dn] where they bite.

---

## 1. Division of responsibility

The plugin observes and reports. It evaluates nothing.

| The plugin does | The server does |
|---|---|
| Watch chat and loot events for the metrics a game asked for | Decide what a metric means for a tile |
| Normalise an observation into a metric ID and a value | Store per-account last-seen values and derive authoritative deltas |
| Report the absolute value where one exists and this observation's increment | Difference cumulative counts; deduplicate delta-only observations |
| Attach a screenshot when asked | Decide whether evidence is needed and whether it is convincing |
| Stop emitting when told to | Own tile capture, line detection, scoring and validation |

The plugin has no concept of a tile, a board, a line, a score or an opponent. If a future
feature requires the plugin to *understand* any of those, that is a contract change, not an
implementation detail.

The plugin can *show* a board, which is not the same thing. `GET /api/plugin/board`
([section 4.5](#45-get-apipluginboard)) returns a document of sections, cells and strings the
server has already decided the wording of. The plugin draws it and interprets none of it: it
cannot tell a bingo grid from a progression ladder, does not know which cells are finished
beyond the shading the server asked for, and computes nothing. The division above is intact —
the server still evaluates everything, it just now has somewhere to publish the result.

## 2. Conventions

Base URL. The player supplies it. There is no default and none is compiled in. All paths
below are relative to it. The plugin appends paths verbatim and strips at most one trailing
slash from what the player typed.

Transport. HTTPS expected; `http://` is accepted so a server can be run on a LAN during
testing. Request and response bodies are `application/json; charset=utf-8`.

Authentication. `POST /api/plugin/sync` and `GET /api/plugin/game` are unauthenticated — the
join code is the only credential. Every other call carries `Authorization: Bearer <playerToken>`.

Versioning. Two independent numbers:

- `schemaVersion` (integer) — the shape of the payloads in this document. Sent on sync and on
  every event envelope. A mismatch is fatal: HTTP 409, and the plugin stops.
- `pluginVersion` (semver string) — the build of the plugin. Sent on sync. The server advertises
  `minPluginVersion` and rejects anything older with HTTP 409.

Adding an optional field is not a schema change. Removing a field, renaming one, changing a
type, or changing the meaning of an existing value is.

Identity. `accountHash` is `client.getAccountHash()`, a signed 64-bit integer that is stable
across display-name changes. It is always sent as a decimal string, because it routinely
exceeds 2^53 and would be silently corrupted by any JSON parser that decodes numbers as IEEE
doubles — which includes `JSON.parse`. The server must key players on this string and must never
key on `displayName`. `displayName` is present only so that logs and admin screens are readable.

Time. All timestamps are epoch milliseconds, UTC. `clientTime` comes from the player's
machine and is unverified — see [§10](#10-what-the-server-must-not-trust).

Nulls. A nullable field is either present with a JSON `null` or absent; the two are
equivalent. A field this document marks required must be present and non-null. The plugin
rejects a response that omits a required field rather than substituting a default.

## 3. Metric IDs

A metric ID is a lowercase, dot-namespaced string. It is derived mechanically from what the game
said, so that a board admin can predict it and the server can match it exactly.

### 3.1 Normalisation

Given a raw activity or item name from the game:

1. Lowercase using the English locale.
2. Replace every run of characters outside `[a-z0-9]` with a single underscore.
3. Strip leading and trailing underscores.
4. Prefix with the family below.

| Family | Prefix | Source | Example |
|---|---|---|---|
| Count | `kc.` | Chat count messages | `Your Vorkath kill count is: 342.` produces `kc.vorkath` |
| Observed kill | `kill.` | RuneLite server NPC-loot events | An Abyssal demon loot occurrence produces `kill.abyssal_demon` |
| Duration | `time.` | Chat duration messages | `Challenge duration: 2:34` at CoX produces `time.chambers_of_xeric` |
| Collection log | `collection_log.` | Chat collection log message | `Dragon pickaxe` produces `collection_log.dragon_pickaxe` |
| Drop | `drop.` | RuneLite loot events | `Abyssal whip` produces `drop.abyssal_whip` |

Worked examples of step 2: `Kree'arra` becomes `kree_arra`; `Chambers of Xeric: Challenge Mode`
becomes `chambers_of_xeric_challenge_mode`; `Grotesque Guardians` becomes `grotesque_guardians`.

The `kc.` prefix is used for every count family, not only kills — completion counts, chest
counts, success counts, harvest counts and lap counts all normalise into `kc.`. The prefix
records that the metric is a cumulative counter, not that a kill occurred.

The `kill.` prefix is deliberately separate. It represents one server-attributed NPC loot
occurrence while the plugin was running, not a game-maintained cumulative KC. It therefore has no
offline or mobile backfill and must never be used as the baseline for a `kc.` metric.

### 3.2 Aliases

Some activities announce themselves under a name a board admin would not think to type, and some
announce under several names for what is really one activity. The plugin ships a small static
map at `src/main/resources/com/millman97/competitivebingo/metric-aliases.json` translating raw activity
names to canonical metric IDs before matching.

The alias map is plugin-side and versioned with the plugin. The server does not receive it
and must not try to reproduce it — it only ever sees canonical IDs. An entry is added only when
it can be justified from a real observed message.

### 3.3 Matching against `trackedMetrics`

The plugin emits an event only if its metric ID matches an entry in `trackedMetrics`. Matching
is exact string equality, with exactly two wildcards permitted:

- `collection_log.*` — matches any metric ID beginning `collection_log.`
- `drop.*` — matches any metric ID beginning `drop.`

No other wildcard, prefix or pattern form exists. There is no regular expression support and
none will be added. A `trackedMetrics` entry containing an asterisk anywhere other than as one
of those two exact strings is a malformed config and the plugin refuses it.

### 3.4 Value-range drop metrics

A game that wants "any drop worth a million or more" cannot express it as a metric ID, because
an ID is derived from an item's name and says nothing about what it is worth. `dropValueRules`
([section 4.1](#41-get-apiplugingamecodejoincode)) is how a game asks for one instead: it names
the metric ID to emit and the range of coin values that earns it.

A rule's metric ID lives in the `drop.` namespace like any other, so it matches, dedupes,
labels and scores exactly as an item metric does. Nothing else about it is special. It does
not need to appear in `trackedMetrics` — naming a rule is what asks for the metric — and listing
it there as well is harmless.

The plugin prices what it received and compares; it has no opinion about which ranges are
interesting or what an item is really worth. The price comes from the running client, so it lags
the live market and differs slightly between clients. That is the reason both prices and the
figure actually compared travel on the event ([section 5.2](#52-detail-by-type)): a server that
wants to settle a tile on a value should settle on its own figure, and use the plugin's to see
why a rule fired.

A stack is priced as a whole: ten items worth 200k each clear a 1m band, one worth 200k does
not. An item with no usable price matches no rule — an untradeable is not worth zero, it is
unpriced, and counting it as zero would silently put it in every band with no lower bound.

A single stack may match several rules. Overlapping bands are the server's business, and a game
that wants both "1m+" and "10m+" to fire on a 12m drop gets exactly that: two events, two metric
IDs, one moment.

One thing to weigh when writing rules: events observed on the same tick each carry their own
copy of that tick's screenshot, and always have. A rule with a low `minValue` — the "count every
coin" shape — therefore roughly doubles a game's screenshot traffic, because it fires alongside
almost every item metric. The batch size ceiling in [section 4.3](#43-post-apipluginevents)
holds regardless, so the effect is more requests rather than larger ones, but a game that wants
a broad rule and does not need evidence for it is better off with `screenshotsRequested: false`.

## 4. Endpoints

### 4.1 GET /api/plugin/game?code={joinCode}

Unauthenticated. Looks up the game a join code refers to. Called when the player presses Sync,
before `POST /api/plugin/sync`, so the plugin can fail on a bad code, a version mismatch or a
finished game before creating any server-side session.

200 response

```jsonc
{
  "gameId": "g_7f3a91",
  "name": "Clan Bingo #4",
  "state": "UPCOMING",              // UPCOMING | LIVE | ENDED | LOCKED
  "startsAt": 1755950400000,
  "endsAt": 1756555200000,
  "schemaVersion": 1,
  "minPluginVersion": "1.0.0",
  "trackedMetrics": ["kc.vorkath", "drop.abyssal_whip", "collection_log.*"],
  "metricLabels": { "kc.vorkath": "Vorkath kills" },
  "metricTargets": { "kc.vorkath": 5 },
  "dropValueRules": [
    {
      "metricId": "drop.worth_1m_plus",       // required, must be under "drop."
      "label": "Drops worth 1m or more",      // nullable
      "minValue": 1000000,                    // nullable, inclusive
      "maxValue": null,                       // nullable, inclusive
      "valuation": "GRAND_EXCHANGE",          // nullable: GRAND_EXCHANGE | HIGH_ALCHEMY
      "counts": "ITEMS"                       // nullable: ITEMS | VALUE
    }
  ],
  "manualEntryAllowed": true,
  "screenshotsRequested": true,
  "blockedWorldTypes": ["SEASONAL", "DEADMAN", "BETA_WORLD", "TOURNAMENT_WORLD", "NOSAVE_MODE"],
  "startWorld": 380
}
```

All fields required except `metricLabels`, `metricTargets`, `dropValueRules`,
`manualEntryAllowed`, `blockedWorldTypes` and `startWorld`, which may be null or omitted.

`metricLabels` is display-only: it feeds the panel's "Targets" list and never influences
behaviour. A label for a metric ID not present in `trackedMetrics` is ignored, except for one
naming a `dropValueRules` entry, which is used. Wildcards may carry a label, keyed by the
wildcard string itself (`"collection_log.*": "Any collection log entry"`).

`metricTargets` maps a metric ID to how many of it the game wants, so the panel reads
"5 Vorkath kills" rather than "Vorkath kills". Also display-only, and more strongly so than
`metricLabels`: the plugin does not track progress towards a target, does not stop reporting
when one is met, and never reports how far along a player is — it has no idea what the server
has already counted, and guessing would be worse than saying nothing. For a `time.` metric the
figure is a threshold in milliseconds rather than a count, and the panel words it as such
("Chambers of Xeric under 30:00"). A metric with no entry has no target, which is normal, and
is the only sensible answer for a wildcard.

`dropValueRules` asks for a metric per range of coin value — see
[section 3.4](#34-value-range-drop-metrics). `valuation` defaults to `GRAND_EXCHANGE` and
`counts` to `ITEMS`; `counts: "VALUE"` makes the event's `delta` the coin value of the stack
rather than the number of items, for a game scored on gp rather than on drops. Null or an empty
list means this game prices nothing and the plugin looks up no prices at all. A rule whose
`metricId` is missing, outside the `drop.` namespace, or a wildcard is a malformed config and
the plugin refuses it, as is a `minValue` above its `maxValue` — a rule that could never fire
looks exactly like a player not getting the drop.

`manualEntryAllowed` decides whether the panel offers the player a way to submit an event by
hand — see [section 5.4](#54-manual-entries). Omitting it, or sending null, allows it: a server
that has never heard of the field behaves the way its players expect. Send `false` to withhold
the control. The plugin refusing to *show* it is a convenience, not a defence; a server that
does not want hand-typed events must reject `"source": "MANUAL"` on ingest.

`blockedWorldTypes` decides which worlds this game refuses to count. The values are
`net.runelite.api.WorldType` enum names. The plugin applies the list verbatim and holds no
opinion of its own: null or an empty list blocks nothing, and a name the running client does not
recognise is skipped rather than guessed at. The list above is the sensible default — those five
either have separate progression or are not the live game — but a game that wants to run during
Leagues is free to send a shorter list.

`startWorld` names the world the organiser wants players on. When it is set and the player is
somewhere else, the panel offers a hop. The plugin will not offer a hop into a world its own
`blockedWorldTypes` rejects, so those two fields must be consistent. Omit it when the game does
not care where people play.

Errors: 404 unknown join code; 409 schema or plugin version mismatch; 410 game ended.

### 4.2 POST /api/plugin/sync

Unauthenticated. Exchanges a join code plus an account hash for a bearer token.

The plugin calls this only while the player is logged in, because `getAccountHash()` returns
`-1` until then.

```jsonc
// request
{
  "joinCode": "SWAMP-TOAD-42",
  "accountHash": "-4234871239847123",
  "displayName": "Safespot Ted",
  "pluginVersion": "0.1.0",
  "schemaVersion": 1
}
```

```jsonc
// 200 response
{
  "playerToken": "opaque-bearer-token",
  "gameId": "g_7f3a91",
  "teamName": "The Sharks",     // null if the admin has not assigned a team yet
  "tokenExpiresAt": 1756555200000
}
```

`playerToken` is opaque to the plugin: it is stored, sent back, and never parsed. It is written
to RuneLite config under a key suffixed with the account hash, so a player with several accounts
holds several tokens simultaneously without clobbering.

Re-syncing with the same join code and account hash is expected and must be idempotent: it
returns a valid token, either the existing one or a fresh one. It must not create a duplicate
player or reset any recorded progress.

Errors: 403 player removed from the game; 404 unknown join code; 409 version mismatch;
410 game ended.

### 4.3 POST /api/plugin/events

Bearer auth. The body is always a JSON array, even for a single event.

```jsonc
[ { /* event envelope, section 5 */ }, { /* ... */ } ]
```

Limits the plugin respects: at most 50 envelopes per request, at most 2 MB of request body, at
most one request in flight at a time, events submitted in the order they were observed. The size
ceiling exists because screenshots travel inside the envelope, so a batch counted only by event
number could otherwise reach tens of megabytes. A single event larger than the ceiling is sent
on its own.

Events observed within the same game tick are gathered into one request, so a kill that produces
a kill count, a drop and a personal best arrives as one call rather than three.

```jsonc
// 200 response
{
  "results": [
    {
      "eventId": "9f2c1ab4e5d60371a8b9c2d3e4f50617",
      "accepted": true,
      "duplicate": false
    },
    {
      "eventId": "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
      "accepted": false,
      "duplicate": false,
      "rejectionReason": "NOT_TRACKED"
    }
  ]
}
```

`results` must contain exactly one entry per submitted envelope. The plugin matches results to
submissions by `eventId`, not by array position — the server may reorder freely.

Per-event rejection is not a transport failure. A batch in which every event is rejected still
returns HTTP 200; the status codes in [§7](#7-errors) describe problems with the request, not
with the events inside it.

`rejectionReason` is a stable machine-readable string, present only when `accepted` is
false. Defined values:

| Reason | Meaning | Plugin behaviour |
|---|---|---|
| `NOT_TRACKED` | Metric is not in this game's `trackedMetrics` | Log at debug; indicates the plugin's copy of `trackedMetrics` is stale, so refresh state |
| `GAME_NOT_LIVE` | Game is UPCOMING, ENDED or LOCKED | Stop emitting; refresh state |
| `OUT_OF_WINDOW` | Event's time falls outside the game window | Log; show in the activity list |
| `INVALID` | Envelope failed server-side validation | Log at error with the full envelope; this is a bug |

`duplicate` is true when the server already held this `eventId` for this game. A duplicate is
still `accepted: true` — it was recorded, just not now.

A retried event carries its screenshot again, so a server that discarded the image from a
request whose response was lost will receive it a second time.

### 4.4 POST /api/plugin/ready

Bearer auth. Reports whether this client is in a state where it can actually observe the metrics
the game asks for.

The point is the roster view: before a game starts, an organiser wants to see who is set up and
who still has a chat filter switched on, rather than finding out afterwards that someone
reported nothing all week. Reporting is all-or-nothing — one failed check stops every metric —
so `ready: false` means this player is currently sending nothing at all.

```jsonc
// request
{
  "ready": false,
  "checks": [
    { "id": "KILL_COUNT_FILTER", "satisfied": true },
    { "id": "WORLD_TYPE", "satisfied": true },
    { "id": "COLLECTION_LOG_NOTIFICATION", "satisfied": false },
    { "id": "LOOT_TRACKER", "satisfied": true }
  ]
}
```

`ready` is true only when every check in `checks` is satisfied. Which checks appear depends on
what the game tracks: the collection log check is present only when the game tracks a
`collection_log.` metric, and the Loot Tracker check only when it tracks a `drop.` metric. The
`id` values are the four in [§9.1](#91-readiness-gating) and are safe to switch on.

Sent when a sync completes, and again whenever the answer changes — a chat setting toggled, a
world hop, the Loot Tracker plugin switched off. Never on a timer. The plugin treats a
failure here as unimportant and simply reports again on the next change; it is a courtesy to the
organiser, not data.

A 2xx with any body, or no body, is success.

Errors: 401 token invalid; 403 player removed; 410 game ended.

### 4.5 GET /api/plugin/board

Bearer auth. Optional, and the only endpoint a server may simply not implement: answer 404 and
the plugin quietly offers no board. Any other failure is treated the same way — a board is a
picture, and failing a sync over one would stop a player reporting for the sake of it.

Called once per successful sync, and again whenever the player presses Refresh in the pop-out.
The plugin never polls it.

200 response

```jsonc
{
  "title": "Clan Bingo #4",                   // required
  "subtitle": "Classic · first line wins",    // nullable
  "capturedAt": 1755950400000,                // required, epoch ms
  "sections": [
    {
      "kind": "GRID",                         // required: GRID | LIST | TEXT
      "title": "Board",                       // nullable
      "rows": 5,                              // GRID; nullable
      "cols": 5,                              // GRID; nullable
      "cells": [                              // GRID and LIST; nullable
        {
          "row": 0,                           // GRID; required there, ignored in a LIST
          "col": 0,
          "title": "Dragon pickaxe",          // required
          "lines": ["3 / 5", "The Sharks"],   // nullable
          "state": "IN_PROGRESS",             // nullable: COMPLETE | IN_PROGRESS |
                                              //   CONTESTED | LOCKED | EMPTY
          "accent": "#c02020",                // nullable, "#rrggbb"
          "tooltip": "Ted, 3 of 5"            // nullable
        }
      ]
    },
    { "kind": "TEXT", "title": "Rules", "body": "Screenshots required for every drop." }
  ]
}
```

This is a document, not a model. Every string in it is shown verbatim — the plugin composes no
wording, computes no progress and decides nothing about what any of it means. That is what makes
it general: a game mode the plugin has never heard of is a different arrangement of the same
three section kinds, and needs no plugin release.

- `GRID` lays `cells` out by their own `row` and `col`. A bingo board, but equally a progression
  ladder, a tech tree, or one row of stages. A cell missing either coordinate is dropped; a
  square with no cell is drawn blank. `rows` and `cols` may be omitted, in which case the plugin
  takes the extent from the cells themselves, and a cell outside the stated size widens the grid
  rather than being discarded.
- `LIST` draws `cells` in the order given, one per row. Teams, standings, a scavenger checklist.
- `TEXT` draws `body` as a paragraph.

Forward compatibility is deliberate and load-bearing here, because this is the part most likely
to grow. A section whose `kind` the plugin does not recognise is skipped and the rest of the
board still draws. A cell whose `state` it does not recognise draws neutral. An `accent` that is
not `#rrggbb` is ignored. A server may therefore add to this vocabulary without waiting for
every player to update — older clients show less, never nothing.

`accent` is drawn as a stripe down the edge of a cell rather than as a fill, so a team colour
never fights the state shading.

`capturedAt` is when the server built the document. The plugin shows it, because the board is a
snapshot from the last sync and a player needs to know it is not live.

Errors: 401 token invalid or expired; 404 no board for this game; 410 game ended.

### 4.6 When the plugin syncs

There is no polling. The plugin issues no request on a fixed interval, and the only GET it
makes is [§4.1](#41-get-apiplugingamecodejoincode), always as the first half of a sync
handshake. A sync happens in exactly three situations:

| When | Why |
|---|---|
| The player presses Sync | The only way to join a game for the first time |
| On login, for a game already joined | So a client that crashed mid-event resumes by itself |
| Once, at a joined lobby's `startsAt` | So a player who joins early is not left blocked |

`POST /sync` must be idempotent: a server should expect an unprompted handshake from a returning
player.

#### Lobbies

When a sync returns `UPCOMING`, the plugin schedules exactly one further sync, at the
`startsAt` the server gave it. That sync then returns either `LIVE`, or `UPCOMING` with a new
`startsAt`, in which case the plugin schedules one more.

A server must never return `UPCOMING` with a `startsAt` in the past. If an organiser has not
started the game by its advertised time, the server must either start it or move `startsAt`
forward. A plugin that syncs at the advertised time and is told the game is still `UPCOMING` and
was due to start in the past stops, and shows the player an error — it will not retry on a
timer. This bounds lobby traffic to one request per scheduled start.

#### Everything else arrives on responses

| The server needs to say | How it reaches the plugin |
|---|---|
| The game has ended | 410 on the next event or ready post |
| Your token is no longer valid | 401 on the next post |
| That metric is not tracked any more | `NOT_TRACKED` per-event rejection |
| Your plugin is too old | 409 |

A client that is not reporting has nothing to learn; one that is reporting finds out on its next
request. The cost is that a mid-game board edit does not reach a player until they sync again.

## 5. The event envelope

```jsonc
{
  "schemaVersion": 1,
  "eventId": "9f2c1ab4e5d60371a8b9c2d3e4f50617",
  "gameId": "g_7f3a91",
  "accountHash": "-4234871239847123",
  "displayName": "Safespot Ted",
  "sessionId": "6b1f0c2e-3a44-4d8b-9f10-27c5e8a1b3d4",
  "clientTime": 1755950400000,
  "gameTick": 123456,
  "world": 302,
  "worldTypes": ["MEMBERS"],
  "metric": {
    "id": "kc.vorkath",
    "type": "COUNT",
    "value": 342,
    "delta": 1,
    "firstObservation": false
  },
  "source": "OBSERVED",                     // required: OBSERVED | MANUAL
  "detail": { "activity": "Vorkath", "rawMessage": "Your Vorkath kill count is: 342." },
  "screenshot": "/9j/4AAQSkZJRgABAQ...",   // base64, or null
  "screenshotMediaType": "image/jpeg"
}
```

`source` says whether the plugin saw this happen or the player typed it — see
[section 5.4](#54-manual-entries). It is always present. A server that does not accept
hand-typed events rejects `MANUAL` on ingest rather than relying on the plugin not offering it.

`worldTypes` are the names of the `net.runelite.api.WorldType` constants set for the current
world. Note the RuneLite constant for a tournament world is `TOURNAMENT_WORLD`, not
`TOURNAMENT`.

`sessionId` is a lowercase RFC 4122 UUID minted by the plugin each time a play session begins —
on login, and again on an account switch. It exists so that `gameTick`, which is a per-client
counter that repeats, cannot produce colliding event IDs across two sessions. It is not
a credential, carries no meaning to the server beyond disambiguation, and is never reused. The
server may use it to group an event stream into sessions; it must not treat it as identity.

### 5.1 value and delta

Both are sent because they answer different questions, and neither can be reconstructed from the
other.

| Type | `value` | `delta` |
|---|---|---|
| `COUNT` | The count the game stated, e.g. `342` | Always `1` |
| `KILL` | Always `null` — this is a delta-only observation | Always `1` |
| `DROP` | Always `null` — a drop is not a counter | Quantity received |
| `DURATION` | Run time in ms | Always `null` |
| `COLLECTION_LOG` | Slots filled, when the game supplied it, else `null` | Always `1` |

`delta` for a `COUNT` is `1` even when `firstObservation` is true. A kill count message announces
exactly one kill; the plugin holding no baseline does not change what happened.

`KILL` credits exactly the one server-attributed NPC loot occurrence carried by the envelope.
Unlike `COUNT`, it has no absolute value to self-heal a missed event against. The server applies
plain event-ID deduplication and may maintain derived rate state for review flags.

The server holds the last-seen `value` per (account, metric) and computes the authoritative
increment itself. That is what makes a retry harmless, lets a missed event self-heal on the next
kill, and exposes off-plugin play: an envelope reporting `value: 342, delta: 1` against a stored
value of `335` means six kills happened somewhere this plugin was not watching.

`value` for `DURATION` breaks that model — lower is better, so monotonic-increase reasoning
does not apply. See.

`firstObservation` is true for the first observation of a metric since the plugin began tracking
the current account — which resets on plugin start and on account switch, not on every login.
It tells the server that a gap against its stored value is unexplained rather than a dropped
event.

### 5.2 detail by type

The server selects the shape by `metric.type`. There is no type discriminator inside `detail`.

Where a shape carries `rawMessage`, it is the chat line with colour and formatting tags
removed and `<br>` replaced by a newline — the text a player saw, not the marked-up string the
client delivered. Tags are display markup and carry no information the server needs, so sending
them would only make the field harder to read in an audit.

```jsonc
// COUNT
{
  "activity": "Vorkath",                                  // required, raw game spelling
  "rawMessage": "Your Vorkath kill count is: 342."        // required
}
```

```jsonc
// KILL
{
  "npcId": 415,                       // required, RuneLite NPC composition ID
  "npcName": "Abyssal demon",        // required, canonical source name
  "combatLevel": 124,                 // nullable
  "signal": "SERVER_NPC_LOOT",       // required
  "observationOrdinal": 0             // required, zero-based within this game tick
}
```

`KILL` is a post-kill observation, not a nearby `ActorDeath`: the server NPC-loot signal attributes
the loot occurrence to the local player. Known encounters that emit multiple loot packets for one
kill are excluded from observed-kill tracking; their authoritative `kc.` messages remain the safe
source. The ordinal preserves two real same-NPC kills on the same tick, which would otherwise have
identical event IDs.

```jsonc
// DROP
{
  "itemId": 4151,                     // required
  "itemName": "Abyssal whip",         // required
  "quantity": 1,                      // required
  "source": "Abyssal demon",          // required
  "sourceType": "NPC",                // required: NPC | PLAYER | PICKPOCKET | EVENT | UNKNOWN
  "killCount": 342,                   // nullable
  "geValue": 2400000,                 // nullable, per item
  "haValue": 72000,                   // nullable, per item
  "ruleValue": 2400000,               // nullable, whole stack
  "observationOrdinal": 0             // required, zero-based within this game tick
}
```

`sourceType` mirrors RuneLite's `LootRecordType`. `killCount` is the plugin's last-seen kill
count for `source` derived from chat, not from the loot event — it is context, it is
frequently null, and it must never be treated as authoritative. The authoritative count arrives
as its own `COUNT` event.

`geValue` and `haValue` are the running client's prices for one of the item, and are null on
every event of a game with no `dropValueRules` — an unpriced game costs no lookups. They are
also null for an item the client has no price for, which is not the same as worth nothing.

`ruleValue` is the figure a value rule was actually tested against: the chosen valuation
multiplied by `quantity`. It is non-null exactly on events a `dropValueRules` entry produced,
and says why the rule did or did not fire. None of these three are authoritative — see
[section 3.4](#34-value-range-drop-metrics).

`observationOrdinal` prevents two identical stacks emitted on the same tick from collapsing to
one event. Retries reuse the same ordinal and therefore remain idempotent.

```jsonc
// DURATION
{
  "activity": "Chambers of Xeric",    // required
  "variant": "Challenge Mode",        // nullable
  "durationMs": 154800,               // required
  "isPersonalBest": true,             // required
  "personalBestMs": 154800,           // nullable
  "rawMessage": "..."                 // required
}
```

`isPersonalBest` reflects what the game announced. `personalBestMs` is populated only when the
game stated a personal best alongside the run.

```jsonc
// COLLECTION_LOG
{
  "itemName": "Dragon pickaxe",       // required
  "completed": 512,                   // nullable
  "totalPossible": 1477               // nullable
}
```

`completed` and `totalPossible` are usually null, because the game only supplies them when
the collection log interface is open. The server must treat null as normal, not exceptional, and
must not use these fields for anything load-bearing.

### 5.3 screenshot

Base64 of the captured frame, carried inside the event itself, or null when there is no image.
The plugin never uploads to any destination other than this endpoint. A server therefore
needs no object-store credentials on the client side and no presigned URLs.

The frame is captured at the moment of observation, not on request, so the image depicts the
event rather than the world a second or two afterwards.

`screenshot` is null when the player disabled screenshots, when the game has
`screenshotsRequested: false`, or when the capture did not complete within its timeout — the
client being minimised is the usual reason.

`screenshotMediaType` is the content type of that image: `image/jpeg`, `image/webp` or
`image/png`. It is non-null exactly when `screenshot` is non-null. WebP is preferred and almost
never available — no Java SE runtime ships a WebP writer and RuneLite bundles none — so in
practice this is `image/jpeg`.

Images are downscaled to at most 1280px wide and target 200KB, so a base64 payload is normally
under 270KB. Servers should still enforce their own ceiling rather than trusting the client.

### 5.4 Manual entries

Some things no parser can see: a raid time only ever shown in an interface, a drop that arrived
before the game started, a count a player has to read off a screen. `manualEntryAllowed` turns
on a control in the panel where the player picks one of the metrics the game already tracks,
types one free-form string, and sends.

Such an envelope carries `"source": "MANUAL"` and a `detail` of this shape, whatever
`metric.type` says:

```jsonc
// MANUAL, any metric type
{
  "activity": "Chambers of Xeric time",   // required, the label the panel showed
  "input": "25:00",                       // required, exactly what was typed
  "interpretedAs": "duration"             // nullable: count | quantity | duration
}
```

The metric type still follows from the metric ID's namespace, and the plugin makes a best-effort
reading of `input` into `metric.value` and `metric.delta` on the same rules as an observed event
of that type: a `kc.` entry reads as the absolute count with a delta of 1, a `kill.` or `drop.`
entry as a quantity, and a `time.` entry as a duration in `mm:ss`, `h:mm:ss.f` or bare seconds. `interpretedAs`
names which of those readings was applied.

**`metric.value` may be null on a `MANUAL` `COUNT` or `DURATION`, where the table in
[section 5.1](#51-value-and-delta) says it never is.** That is the one place a manual envelope
differs in shape, and it is deliberate: refusing an input nothing could be read out of would
take away the only route for exactly the cases manual entry exists to cover. `input` is always
there to be read, by a server or by the organiser reviewing it.

A manual event carries a screenshot only when the player has screenshots enabled and the game set
`screenshotsRequested`. The picture is useful evidence for a figure nobody watched being earned,
but both parties have to ask for it: the player's setting is the privacy opt-in, and the game's
setting prevents unnecessary image transfer when the organiser does not intend to retain it.

The plugin vouches for the screenshot and for nothing else. A server accepting these should
expect to review them: this is the one event kind whose contents a player chose.

## 6. eventId and deduplication

`eventId` is derived deterministically from the observation, so the same observation submitted
twice produces the same ID and dedupes server-side.

Take the SHA-256 of the UTF-8 encoding of the fields below joined with a `|` character, then take
the first 16 bytes as lowercase hex — 32 characters. Integers are rendered in plain decimal with
no grouping separators and no sign for positives.

| Type | Hashed fields, in order |
|---|---|
| `COUNT` | `accountHash`, `sessionId`, `metricId`, `gameTick`, `value` |
| `DURATION` | `accountHash`, `sessionId`, `metricId`, `gameTick`, `value` |
| `KILL` | `accountHash`, `sessionId`, `metricId`, `gameTick`, `npcId`, `observationOrdinal` |
| `DROP` | `accountHash`, `sessionId`, `metricId`, `gameTick`, `itemId`, `quantity`, `observationOrdinal` |
| `COLLECTION_LOG` | `accountHash`, `metricId` |
| any type, `source: MANUAL` | `accountHash`, `sessionId`, `metricId`, `gameTick`, the literal `manual`, `input` |

Worked example, which a server implementation should use as its own test vector:

```
input   -4234871239847123|6b1f0c2e-3a44-4d8b-9f10-27c5e8a1b3d4|kc.vorkath|123456|342
sha256  777f44d8a5a8a5a82c72a18de4c026da975a8f1133b401f430336f7452076da3
eventId 777f44d8a5a8a5a82c72a18de4c026da   (first 16 bytes, lowercase hex)
```

`sessionId` participates in every derivation except `COLLECTION_LOG`. Retries stay idempotent
because a retry reuses the whole envelope, `sessionId` included; a retry never spans sessions.

A `MANUAL` ID is derived from what was typed rather than from the value read out of it, and takes
its own derivation whatever the metric type. Two consequences, both intended: pressing send twice
by accident dedupes, and correcting a figure — a different string — is a new event rather than a
silent no-op. The literal `manual` is in there so a hand-typed entry can never collide with an
observed one on the same tick.

A `COLLECTION_LOG` ID intentionally omits both time and session. A collection log slot is
filled once, ever; the same slot reported twice is the same fact regardless of when — or in
which session — it was noticed.

Deduplication scope is (gameId, eventId), not eventId alone. `gameId` is not part of the
hash, so the same player reporting the same kill into two concurrent games produces the same ID
in both. Those are two distinct facts and must both be recorded.

The server may recompute the hash to verify an envelope has not been hand-edited. It is a
consistency check, not a security control — the inputs are all client-supplied.

## 7. Errors

Non-2xx responses carry:

```jsonc
{
  "error": "UNKNOWN_JOIN_CODE",
  "message": "That join code doesn't match any game.",
  "requiredVersion": "1.2.0"          // 409 only
}
```

`message` is shown to the player verbatim in the side panel, so write it for a player.

| Status | Meaning | Plugin behaviour |
|---|---|---|
| 400 | Malformed request | Log at error with the body. This is a plugin bug; do not retry |
| 401 | Token invalid or expired | Discard the token, stop emitting, show "re-sync required" |
| 403 | Player not on a team, or removed | Stop emitting, show `message` |
| 404 | Unknown join code | Fail the sync attempt visibly. Never retried |
| 409 | Schema or plugin version mismatch | Stop, show the required version from `requiredVersion` |
| 410 | Game ended | Stop emitting, show final state |
| 429 | Rate limited | Honour `Retry-After`, then resume, for at most three responses and five minutes of requested delay |
| 5xx | Server problem | Retry per section 8 |

Anything not listed is treated as its class: other 4xx behave like 400, other 5xx like 500.

## 8. Retry

Transient network failure is the single place this plugin is forgiving. Everything else fails
immediately and visibly.

Retried: connection failure, read/write timeout, and 5xx. Exponential backoff starting at
2 seconds, 3 attempts total, then give up.

Never retried: any 4xx other than 429. A 429 schedules a resume at the time the server names.
Three consecutive rate-limit responses abandon the batch, as does a requested delay longer than
five minutes; a server cannot make the client retain and retry one batch forever.

After three failures the event is marked failed in the panel's activity list and dropped. It is
not persisted to disk and not re-queued. This is safe precisely because of the absolute-value
design in section 5.1: the next observation of the same metric carries the correct total, and
the server reconciles. A dropped event costs timing accuracy, not correctness.

Retries reuse the identical envelope, including `eventId` and the original `clientTime`. The
plugin never re-stamps a retry with a fresh timestamp.

## 9. Behaviours the server may rely on

- Opt-in. No request of any kind is made until the player has entered a base URL and a join
  code and pressed Sync. Nothing is compiled in.
- Sync may repeat without a button press. Having joined a game, the plugin re-runs the same
  handshake on login until that game ends, so a client that crashed mid-event resumes reporting
  by itself. Expect `GET /game` followed by `POST /sync` for a returning player, with no user
  action behind it. Re-syncing must therefore stay idempotent — same player, same progress. The
  plugin stops attempting it once the game's `endsAt` has passed, or after any 403, 409 or 410.
- No polling endpoint. Every GET this plugin makes is part of a sync handshake — there is
  no separate status endpoint and no fixed-interval traffic. Everything else is a POST caused by
  something that happened: an event was observed, or the readiness answer changed.
- A sync is not always a button press. The same handshake repeats on login for a game
  already joined, and while waiting for a joined lobby to start. Both stop on their own. See
  below.
- Filtering is client-side first. An event is built and sent only if its metric matches
  `trackedMetrics`. A `NOT_TRACKED` rejection means the plugin's copy is stale, not that the
  plugin is spraying.
- Emission requires LOGGED_IN. Nothing is emitted from the login screen or during loading.
- Emission stops on `ENDED`, `LOCKED`, 401, 403, 410, a failed readiness check, or a world
  type the plugin refuses to play on.
- Ordering. Events are dispatched in observation order by a single-threaded sender. At most
  one request is in flight.
- Volume. Bounded by how fast a human can kill things. Tens of events per hour per player is
  a busy session.
- Account switching starts a fresh session: baselines reset, `firstObservation` becomes true
  again, and that account's own token is loaded.

### 9.1 Readiness gating

The plugin refuses to sync, and stops emitting if the situation changes mid-game, when any of
these fail. Each is surfaced as a red item in the panel with a one-line fix.

| Check | Source | Requirement |
|---|---|---|
| Boss kill count spam filter off | varbit `BOSS_KILLCOUNT_FILTERED` (4930) | must be `0`, else count messages never reach chat |
| Collection log chat notification on | varbit `OPTION_COLLECTION_NEW_ITEM` (11959) | bit 0 must be set, i.e. value `1` or `3`. Value `2` is popup-only and produces no chat line. Only required when the game tracks any `collection_log.` metric |
| World type permitted | `client.getWorldType()` | must not contain `SEASONAL`, `DEADMAN`, `BETA_WORLD`, `TOURNAMENT_WORLD` or `NOSAVE_MODE`. Members, F2P and PvP worlds are all fine |
| Loot Tracker plugin enabled | RuneLite `PluginManager` | required when the game tracks any `drop.` metric — RuneLite emits no loot events at all while it is off |

There are four checks, not the three originally specified. The fourth exists because drop
detection is built on RuneLite's own Loot Tracker plugin, which a player may have switched off.

## 10. What the server must not trust

Everything in an envelope originates on a machine the player controls.

- `clientTime` is the player's system clock. Use it for ordering and display; use server receipt
  time for anything that decides whether an event falls inside the game window.
- `value`, `delta` and every `detail` field are asserted, not proven. The absolute-value design
  in section 5.1 exists so the server can cross-check them against its own stored history and
  against end-of-event hiscores, not so it can take them at face value.
- `eventId` is client-computed. Recomputing it detects clumsy tampering only.
- `displayName` is not identity. `accountHash` is.
- A screenshot is a picture a client chose to send. It is evidence of nothing on its own, and
  a modified client can attach whatever it likes.
- A player running a modified build can send anything this document permits. The contract's job
  is to make honest clients unambiguous, not to make dishonest ones impossible.

## 11. Changelog

| Schema version | Draft | Change |
|---|---|---|
| 1 | 6 | Completed the initial contract: value-range drop metrics, per-metric targets, manual events, the optional board document, delta-only monster kills, and collision-safe ordinals for simultaneous kills and drops. Screenshots live inside the event envelope; batches are capped by payload size and count; lobbies re-sync once at `startsAt`. |
| 1 | 5 | Documented when a sync happens without a button press: login resume, and waiting out an unstarted lobby. |
| 1 | 4 | Added `screenshotMediaType` to the envelope. |
| 1 | 3 | Removed `GET /api/plugin/state` and all polling; added `POST /api/plugin/ready`. |
| 1 | 2 | Added `sessionId` to the envelope and to the `COUNT`, `DURATION` and `DROP` event ID derivations. Screenshot capture moved to observation time. Added the Loot Tracker readiness check. |
| 1 | 1 | Initial draft. |
