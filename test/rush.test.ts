// RUSH mode through the real stack.
//
// The rule is one sentence — the first team to finish a tile takes it and keeps it — and every
// test here is about the half of that sentence which is hard: "keeps it". Ownership has to survive
// being overtaken, survive a replay rebuilding tile progress from nothing, and still move when the
// evidence behind the claim is taken away.

import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import { findGameById } from '../src/worker/db/games';
import { replayGame } from '../src/worker/scoring/replay';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { assignTeam, seedGame, seedTiles, type SeedTile } from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

/** A 3x3 board where every tile is one kill, so a line is quick to build. */
const oneKillBoard = (): SeedTile[] => {
  const tiles: SeedTile[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      tiles.push({
        row,
        col,
        label: `${row},${col}`,
        metrics: [`kc.tile_${row}_${col}`],
        aggregate: 'SUM',
        target: 1,
      });
    }
  }
  return tiles;
};

let seq = 0;

const setUp = async (options: { tiles?: SeedTile[]; endsAt?: number } = {}) => {
  const tiles = options.tiles ?? oneKillBoard();

  const game = await seedGame(env.DB, {
    mode: 'RUSH',
    backfillPolicy: 'IGNORE',
    state: 'LIVE',
    trackedMetrics: tiles.flatMap((tile) => tile.metrics),
    ...(options.endsAt === undefined ? {} : { endsAt: options.endsAt }),
  });

  await env.DB.prepare('UPDATE games SET board_rows = 3, board_cols = 3 WHERE id = ?')
    .bind(game.id)
    .run();

  const tileIds = await seedTiles(env.DB, game.id, tiles);

  const clients: SimulatedClient[] = [];
  for (const team of [0, 1] as const) {
    const hash = `-42${team}${(seq += 1)}`;
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({
        accountHash: hash,
        displayName: team === 0 ? 'Shark' : 'Manta',
        gameId: game.id,
      }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, hash, game.teams[team]!.id);
    clients.push(client);
  }

  return { game, tileIds, shark: clients[0]!, manta: clients[1]! };
};

const take = async (client: SimulatedClient, row: number, col: number): Promise<void> => {
  await client.sendOne(await client.player.kill(`Tile ${row} ${col}`));
};

const ownerOf = async (gameId: string, tileId: string) =>
  env.DB.prepare(
    'SELECT owner_team_id, contested FROM tile_ownership WHERE game_id = ? AND tile_id = ?',
  )
    .bind(gameId, tileId)
    .first<{ owner_team_id: string | null; contested: number }>();

const owners = async (gameId: string) => {
  const { results } = await env.DB.prepare(
    'SELECT tile_id, owner_team_id FROM tile_ownership WHERE game_id = ? ORDER BY tile_id',
  )
    .bind(gameId)
    .all();
  return results;
};

describe('claiming a tile', () => {
  it('gives it to the team that finished it', async () => {
    const { game, tileIds, shark } = await setUp();

    await take(shark, 0, 0);

    expect(await ownerOf(game.id, tileIds[0]!)).toMatchObject({
      owner_team_id: game.teams[0]!.id,
      contested: 0,
    });
  });

  // The whole difference from CONTROL, where this second kill would tie the tile and contest it.
  it('keeps it when the other team finishes the same tile afterwards', async () => {
    const { game, tileIds, shark, manta } = await setUp();

    await take(shark, 0, 0);
    await take(manta, 0, 0);

    expect(await ownerOf(game.id, tileIds[0]!)).toMatchObject({
      owner_team_id: game.teams[0]!.id,
      contested: 0,
    });
  });

  it('keeps it when the other team goes on to outscore them on it', async () => {
    const tiles: SeedTile[] = [
      { row: 0, col: 0, metrics: ['kc.tile_0_0'], aggregate: 'SUM', target: 2 },
      // A tile nobody touches, so the board never fills up and ends the game underneath us.
      { row: 2, col: 2, metrics: ['kc.tile_2_2'], aggregate: 'SUM', target: 1 },
    ];
    const { game, tileIds, shark, manta } = await setUp({ tiles });

    await take(shark, 0, 0);
    await take(shark, 0, 0);
    expect(await ownerOf(game.id, tileIds[0]!)).toMatchObject({
      owner_team_id: game.teams[0]!.id,
    });

    for (let i = 0; i < 5; i++) {
      await take(manta, 0, 0);
    }

    expect(await ownerOf(game.id, tileIds[0]!)).toMatchObject({
      owner_team_id: game.teams[0]!.id,
    });
  });

  it('never contests a tile', async () => {
    const { game, tileIds, shark, manta } = await setUp();

    await take(shark, 0, 0);
    await take(manta, 0, 0);

    const { results } = await env.DB.prepare(
      'SELECT contested FROM tile_ownership WHERE game_id = ?',
    )
      .bind(game.id)
      .all<{ contested: number }>();

    expect(results.every((row) => row.contested === 0)).toBe(true);
    expect(tileIds).not.toHaveLength(0);
  });
});

// A claim is recomputed from stored standings rather than stamped once, so that a replay reaches
// the same board. This is the test that would catch it being stamped.
describe('a replay', () => {
  it('rebuilds the same claims from the event log', async () => {
    const { game, shark, manta } = await setUp();

    await take(shark, 0, 0);
    await take(manta, 0, 0);
    await take(manta, 0, 1);
    await take(shark, 1, 1);
    await take(manta, 1, 1);

    const before = await owners(game.id);

    await replayGame(env.DB, game.id);

    // Ownership is derived from tile progress, so rebuilding progress has to reproduce it.
    const loaded = await findGameById(env.DB, game.id);
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(game.id));
    await stub.fetch(`https://do/reload?gameId=${loaded!.id}`, { method: 'POST' });

    expect(await owners(game.id)).toEqual(before);
  });
});

describe('winning', () => {
  it('ends the moment a team completes a line', async () => {
    const { game, shark } = await setUp();

    await take(shark, 0, 0);
    await take(shark, 0, 1);
    await take(shark, 0, 2);

    const after = await findGameById(env.DB, game.id);
    expect(after).toMatchObject({ state: 'ENDED', wonByTeamId: game.teams[0]!.id });
  });

  // Nothing anybody does can move a full board, so waiting for the deadline only delays a result
  // that is already decided.
  //
  // The tiles are shared out so that no team ever holds a whole row, column or diagonal — a 3x3
  // board has eight lines in it and the easy layouts all contain one, which would end the game
  // down the line-wins path and leave this ending untested. Claims never move in RUSH, so a
  // layout with no line at the end never had one on the way there either.
  it('ends on tiles held once every tile has been taken', async () => {
    const { game, shark, manta } = await setUp();

    const sharkTiles = [
      [0, 0],
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const;
    const mantaTiles = [
      [0, 2],
      [1, 0],
      [1, 1],
      [2, 1],
    ] as const;

    for (const [row, col] of sharkTiles) {
      await take(shark, row, col);
    }
    for (const [row, col] of mantaTiles) {
      await take(manta, row, col);
    }

    // Eight of nine claimed, and nobody has a line.
    expect(await findGameById(env.DB, game.id)).toMatchObject({ state: 'LIVE' });

    // The ninth gives Manta five tiles to Shark's four.
    await take(manta, 2, 2);

    expect(await findGameById(env.DB, game.id)).toMatchObject({
      state: 'ENDED',
      wonByTeamId: game.teams[1]!.id,
    });
  });

  it('is decided on tiles held when the clock runs out', async () => {
    const { game, shark, manta } = await setUp({ endsAt: Date.now() + 60_000 });

    await take(shark, 0, 0);
    await take(shark, 0, 1);
    await take(manta, 1, 1);

    await env.DB.prepare('UPDATE games SET ends_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, game.id)
      .run();

    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(game.id));
    await runDurableObjectAlarm(stub);

    expect(await findGameById(env.DB, game.id)).toMatchObject({
      state: 'ENDED',
      wonByTeamId: game.teams[0]!.id,
    });
  });
});
