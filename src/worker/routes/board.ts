// Public read access to a live board.
//
// No login: this is the link that goes in the clan Discord.

import { Hono } from 'hono';

import type { Env } from '../env';
import { readActivity, readRoster, readTileDetail } from '../db/activity';
import { findGameById, type Game } from '../db/games';
import { loadTiles } from '../db/tiles';
import { ApiError } from '../lib/errors';
import { roomSnapshot, roomSocket } from '../do/client';

type BoardBindings = { Bindings: Env; Variables: { game: Game } };

/** Every route here is about one game, and none of them mean anything without it. */
const requireGame: import('hono').MiddlewareHandler<BoardBindings> = async (c, next) => {
  const game = await findGameById(c.env.DB, c.req.param('gameId') as string);

  if (game === null) {
    throw new ApiError(404, 'NOT_FOUND', 'No such game.');
  }

  c.set('game', game);
  await next();
};

export const boardRoutes = new Hono<BoardBindings>()

  // The live feed. Everything after the first paint arrives here.
  .get('/:gameId/socket', requireGame, async (c) =>
    roomSocket(c.env, c.get('game').id, c.req.raw, c.req.query('since') ?? null),
  )

  // One line per scoring event, newest first. Paginated over HTTP rather than pushed, because a
  // board changes a few times an hour and a feed grows without bound.
  .get('/:gameId/activity', requireGame, async (c) => {
    const game = c.get('game');
    const limit = Number(c.req.query('limit') ?? '30');

    const page = await readActivity(c.env.DB, game.id, await loadTiles(c.env.DB, game.id), {
      limit: Number.isFinite(limit) ? limit : 30,
      before: c.req.query('before') ?? null,
    });

    return c.json(page);
  })

  // Who is on each team and what they have contributed. Read separately from the board because it
  // changes constantly but matters far less urgently than a tile flipping.
  .get('/:gameId/teams', requireGame, async (c) => {
    const game = c.get('game');
    return c.json(await readRoster(c.env.DB, game.id, await loadTiles(c.env.DB, game.id)));
  })

  // The full breakdown behind one tile: who contributed what, and every image held for it.
  .get('/:gameId/tiles/:tileId', requireGame, async (c) => {
    const game = c.get('game');
    const tileId = c.req.param('tileId');

    const tile = (await loadTiles(c.env.DB, game.id)).find((entry) => entry.id === tileId);
    if (tile === undefined) {
      throw new ApiError(404, 'NOT_FOUND', 'No such tile.');
    }

    return c.json(await readTileDetail(c.env.DB, game.id, tile));
  })

  // Evidence. Served through the Worker rather than from a public bucket, so a screenshot is
  // reachable only by someone who already knows the game and the event it belongs to.
  .get('/:gameId/screenshots/:eventId', requireGame, async (c) => {
    const game = c.get('game');

    const held = await c.env.DB.prepare(
      'SELECT object_key, media_type FROM event_screenshots WHERE game_id = ? AND event_id = ?',
    )
      .bind(game.id, c.req.param('eventId'))
      .first<{ object_key: string; media_type: string }>();

    if (held === null) {
      throw new ApiError(404, 'NOT_FOUND', 'No screenshot for that event.');
    }

    const object = await c.env.SCREENSHOTS.get(held.object_key);
    if (object === null) {
      throw new ApiError(404, 'NOT_FOUND', 'That screenshot is no longer stored.');
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': held.media_type,
        // The image for an event never changes, so it can be cached hard.
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: object.httpEtag,
      },
    });
  })

  // The fallback, and the first paint. A client that cannot open a socket reads this instead of
  // polling — polling is deliberately not the primary path.
  .get('/:gameId', requireGame, async (c) => roomSnapshot(c.env, c.get('game').id));
