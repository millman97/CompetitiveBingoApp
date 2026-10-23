// The five endpoints the RuneLite plugin calls.
//
// Exact conformance is required: this is implemented against a shipped plugin that is already in
// players' clients. There is deliberately no GET /api/plugin/state — the plugin never polls, and
// an endpoint it will not call is dead code [D13].

import { Hono } from 'hono';

import { minPluginVersion, signingKey, SCHEMA_VERSION, type Env } from '../env';
import {
  findGameByJoinCode,
  findGameById,
  listDropValueRules,
  listTrackedMetrics,
  startIfDue,
  type Game,
} from '../db/games';
import { loadTiles } from '../db/tiles';
import { buildBoardState } from '../do/board-state';
import { toPluginBoard } from '../do/plugin-board';
import { findPlayer, findTeamName, upsertPlayer, type Player } from '../db/players';
import { parseReadiness, saveReadiness } from '../db/readiness';
import {
  ApiError,
  gameEnded,
  malformedRequest,
  playerRemoved,
  pluginTooOld,
  schemaMismatch,
  tokenInvalid,
  unknownJoinCode,
} from '../lib/errors';
import { toWireState } from '../lib/game-state';
import { isOlder } from '../lib/semver';
import { signToken, verifyToken, type PlayerTokenData } from '../lib/tokens';
import type { EventResult } from '../ingest';
import { ingestInRoom } from '../do/client';

/** The plugin sends at most 50 envelopes per request. More than that is a plugin bug. */
const MAX_BATCH = 50;

/**
 * And at most 2 MB, which the plugin enforces on its own side.
 *
 * The size ceiling exists because screenshots travel inside the envelope, so a batch counted only
 * by event number could otherwise reach tens of megabytes.
 */
const MAX_BATCH_BYTES = 2 * 1024 * 1024;

/** Outlives the game so late uploads and retries still authenticate. */
const TOKEN_GRACE_MS = 24 * 60 * 60 * 1000;

const ACCOUNT_HASH = /^-?[0-9]{1,20}$/;

/**
 * World types this server refuses to count progress from.
 *
 * The plugin holds no opinion of its own any more: it applies whatever list the game sends,
 * verbatim, and null or an empty list blocks nothing at all. Omitting this would therefore count
 * kills earned on Leagues and deadman worlds, where progression is separate from the live game.
 *
 * These five are the sensible default rather than a rule — a clan running a bingo *during* Leagues
 * would want a shorter list, which is why the plugin takes it from the server.
 */
const BLOCKED_WORLD_TYPES = [
  'SEASONAL',
  'DEADMAN',
  'BETA_WORLD',
  'TOURNAMENT_WORLD',
  'NOSAVE_MODE',
];

type PluginBindings = {
  Bindings: Env;
  Variables: { game: Game; player: Player };
};

/**
 * Bearer auth for every authenticated plugin call.
 *
 * The token is stateless — signature plus expiry — so removal is enforced on the player row here
 * rather than by trying to revoke a token that cannot be revoked.
 */
const requirePlayer: import('hono').MiddlewareHandler<PluginBindings> = async (c, next) => {
  const header = c.req.header('Authorization');
  if (header === undefined || !header.startsWith('Bearer ')) {
    throw tokenInvalid();
  }

  const data = await verifyToken<PlayerTokenData>(
    signingKey(c.env),
    'player',
    header.slice('Bearer '.length),
  );
  if (data === null) {
    throw tokenInvalid();
  }

  const loaded = await findGameById(c.env.DB, data.gameId);
  if (loaded === null || loaded.state === 'ENDED') {
    // 410 makes the plugin forget the game rather than chase it on every login.
    throw gameEnded();
  }

  const game = await startIfDue(c.env.DB, loaded, Date.now());

  const player = await findPlayer(c.env.DB, game.id, data.accountHash);
  if (player === null) {
    throw tokenInvalid();
  }
  if (player.removedAt !== null) {
    throw playerRemoved();
  }

  c.set('game', game);
  c.set('player', player);
  await next();
};

/**
 * How many of each metric the game wants, for the panel's Targets list.
 *
 * Read off the board rather than configured separately — a tile already says how many it needs.
 * A metric used by several tiles with different targets is omitted: display-only or not, showing
 * one of two contradictory numbers is worse than showing none.
 */
const metricTargetsFor = async (
  db: D1Database,
  gameId: string,
): Promise<Record<string, number> | null> => {
  const tiles = await loadTiles(db, gameId);
  const targets = new Map<string, number | null>();

  for (const tile of tiles) {
    if (tile.requirement.target === null) {
      continue;
    }
    for (const metric of tile.requirement.metrics) {
      // A wildcard has no meaningful target: "3 Any drop" reads as nonsense, and the contract
      // says no entry is the only sensible answer for one.
      if (metric.endsWith('.*')) {
        continue;
      }
      const seen = targets.get(metric);
      targets.set(
        metric,
        seen === undefined || seen === tile.requirement.target ? tile.requirement.target : null,
      );
    }
  }

  const resolved: Record<string, number> = {};
  for (const [metric, target] of targets) {
    if (target !== null) {
      resolved[metric] = target;
    }
  }

  return Object.keys(resolved).length > 0 ? resolved : null;
};

export const pluginRoutes = new Hono<PluginBindings>()

  // ---------------------------------------------------------------------------
  // 4.1 GET /api/plugin/game?code={joinCode}
  // ---------------------------------------------------------------------------
  // Unauthenticated: the join code is the only credential. Called before sync so the plugin can
  // fail on a bad code, a version mismatch or a finished game before any session exists.
  .get('/game', async (c) => {
    const code = c.req.query('code');
    if (code === undefined || code.trim() === '') {
      throw malformedRequest('no join code was given.');
    }

    const found = await findGameByJoinCode(c.env.DB, code);
    if (found === null) {
      throw unknownJoinCode();
    }
    if (found.state === 'ENDED') {
      throw gameEnded();
    }
    // The plugin syncs once at the startsAt we name and does not retry on a timer, so a game that
    // is still UPCOMING past its own start time would strand every player waiting on it.
    const game = await startIfDue(c.env.DB, found, Date.now());

    const tracked = await listTrackedMetrics(c.env.DB, game.id);
    const rules = await listDropValueRules(c.env.DB, game.id);

    const labels: Record<string, string> = {};
    for (const entry of tracked) {
      if (entry.label !== null) {
        labels[entry.metricId] = entry.label;
      }
    }
    // A label naming a value rule is used even though the rule is not in trackedMetrics.
    for (const rule of rules) {
      if (rule.label !== null) {
        labels[rule.metricId] = rule.label;
      }
    }

    // The plugin compares schemaVersion and minPluginVersion itself and refuses to sync if either
    // is wrong, which is why this call carries no plugin version and cannot answer 409.
    return c.json({
      gameId: game.id,
      name: game.name,
      state: toWireState(game.state),
      startsAt: game.startsAt,
      endsAt: game.endsAt,
      schemaVersion: SCHEMA_VERSION,
      minPluginVersion: minPluginVersion(c.env),
      trackedMetrics: tracked.map((entry) => entry.metricId),
      metricLabels: Object.keys(labels).length > 0 ? labels : null,
      metricTargets: await metricTargetsFor(c.env.DB, game.id),
      dropValueRules: rules.length > 0 ? rules : null,
      manualEntryAllowed: game.manualEntryAllowed,
      screenshotsRequested: game.screenshotsRequested,
      blockedWorldTypes: BLOCKED_WORLD_TYPES,
      // Not offered yet: the plugin will show a hop prompt when a game names a start world.
      startWorld: null,
    });
  })

  // ---------------------------------------------------------------------------
  // 4.2 POST /api/plugin/sync
  // ---------------------------------------------------------------------------
  // Unauthenticated. Exchanges a join code plus an account hash for a bearer token.
  //
  // Idempotent by contract, and some calls have no user behind them: the plugin re-syncs on login
  // for a game it already joined, and once at the scheduled start of an unstarted lobby.
  .post('/sync', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (body === null) {
      throw malformedRequest('the request body was not JSON.');
    }

    const { joinCode, accountHash, displayName, pluginVersion, schemaVersion } = body;

    if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
      throw malformedRequest('the request did not say which schema version it speaks.');
    }
    if (schemaVersion !== SCHEMA_VERSION) {
      throw schemaMismatch(SCHEMA_VERSION, schemaVersion);
    }
    if (typeof joinCode !== 'string' || joinCode.trim() === '') {
      throw malformedRequest('no join code was given.');
    }
    // Kept as a string all the way down. It exceeds 2^53 and any trip through a JS number
    // silently corrupts it into a different player.
    if (typeof accountHash !== 'string' || !ACCOUNT_HASH.test(accountHash)) {
      throw malformedRequest('the account identifier was not in the expected form.');
    }
    // Empty is allowed, and the plugin really does send it: getLocalPlayer().getName() is null
    // for a moment after login even though getAccountHash() is already valid, and the plugin
    // sends "" rather than holding the sync back. Refusing it would block a player over a field
    // the contract calls display-only and explicitly not identity. A later login, manual sync or
    // scheduled lobby-start sync can fill the display name without blocking event reporting.
    if (typeof displayName !== 'string') {
      throw malformedRequest('the display name was not in the expected form.');
    }
    if (typeof pluginVersion !== 'string' || pluginVersion === '') {
      throw malformedRequest('the request did not say which plugin version it is.');
    }

    const found = await findGameByJoinCode(c.env.DB, joinCode);
    if (found === null) {
      throw unknownJoinCode();
    }
    if (found.state === 'ENDED') {
      throw gameEnded();
    }
    const game = await startIfDue(c.env.DB, found, Date.now());

    const required = minPluginVersion(c.env);
    if (isOlder(pluginVersion, required)) {
      throw pluginTooOld(required);
    }

    // 403 is only ever for a player an admin explicitly removed. A player who has synced but has
    // no team yet is accepted, with teamName null — spec section 3.3. Refusing them would mean
    // anyone who syncs before the roster is finished silently reports nothing all event.
    const existing = await findPlayer(c.env.DB, game.id, accountHash);
    if (existing !== null && existing.removedAt !== null) {
      throw playerRemoved();
    }

    const now = Date.now();
    const player = await upsertPlayer(c.env.DB, game.id, accountHash, displayName, now);

    const tokenExpiresAt = game.endsAt + TOKEN_GRACE_MS;
    const playerToken = await signToken<PlayerTokenData>(
      signingKey(c.env),
      'player',
      { gameId: game.id, accountHash },
      tokenExpiresAt,
    );

    return c.json({
      playerToken,
      gameId: game.id,
      teamName: player.teamId === null ? null : await findTeamName(c.env.DB, player.teamId),
      tokenExpiresAt,
    });
  })

  // ---------------------------------------------------------------------------
  // 4.3 POST /api/plugin/events
  // ---------------------------------------------------------------------------
  // The body is always an array, even for a single event. Per-event rejection is not a transport
  // failure: a batch in which every event is rejected still returns HTTP 200.
  .post('/events', requirePlayer, async (c) => {
    // A declared length lets an oversized request be refused without reading it at all. It is
    // only a fast path: the header is advisory, so the body that actually arrives is measured too.
    const declared = Number(c.req.header('Content-Length') ?? '0');
    if (declared > MAX_BATCH_BYTES) {
      throw malformedRequest(
        `that batch is too large (${declared} bytes, limit ${MAX_BATCH_BYTES}).`,
      );
    }

    const raw = await c.req.text();
    const size = new TextEncoder().encode(raw).byteLength;
    if (size > MAX_BATCH_BYTES) {
      throw malformedRequest(`that batch is too large (${size} bytes, limit ${MAX_BATCH_BYTES}).`);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw malformedRequest('the request body was not JSON.');
    }

    if (!Array.isArray(body)) {
      throw malformedRequest('the events endpoint expects an array.');
    }
    if (body.length > MAX_BATCH) {
      throw malformedRequest(`too many events in one request (${body.length}, limit ${MAX_BATCH}).`);
    }

    const game = c.get('game');
    const player = c.get('player');

    // Storage, order-dependent COUNT derivation and board settlement all happen inside the same
    // per-game Durable Object. Two clients therefore cannot read the same metric baseline, and a
    // replay cannot erase state while a live request is rebuilding it.
    const results: EventResult[] = await ingestInRoom(c.env, {
      gameId: game.id,
      accountHash: player.accountHash,
      envelopes: body,
    });

    // Exactly one entry per submitted envelope. The plugin matches by eventId, not by position.
    return c.json({ results });
  })

  // ---------------------------------------------------------------------------
  // 4.5 GET /api/plugin/board
  // ---------------------------------------------------------------------------
  // Optional, and the only endpoint a server may simply not implement. A board is a picture, and
  // failing a sync over one would stop a player reporting for the sake of it — so a game with no
  // tiles answers 404 and the plugin quietly offers no pop-out.
  //
  // Authenticated, which is what lets it show the player their own team's numbers first.
  .get('/board', requirePlayer, async (c) => {
    const game = c.get('game');
    const tiles = await loadTiles(c.env.DB, game.id);

    if (tiles.length === 0) {
      throw new ApiError(404, 'NOT_FOUND', 'This game has no board.');
    }

    const board = await buildBoardState(c.env.DB, game, tiles);

    return c.json(toPluginBoard(board, c.get('player').teamId, Date.now()));
  })

  // ---------------------------------------------------------------------------
  // 4.4 POST /api/plugin/ready
  // ---------------------------------------------------------------------------
  // Reports whether this client can currently observe anything at all. Sent on sync and whenever
  // the answer changes, never on a timer. The plugin treats a failure here as unimportant, so
  // this is a courtesy to the organiser rather than data — but it is the single most useful
  // pre-event screen, so it is stored properly.
  .post('/ready', requirePlayer, async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    const report = parseReadiness(body);

    if (report === null) {
      throw malformedRequest('the readiness report was not in the expected form.');
    }

    await saveReadiness(c.env.DB, c.get('player').id, report, Date.now());

    return c.json({ ok: true });
  });
