// CLASSIC scoring, end to end through the real HTTP surface.
//
// Every team works the same board independently: a tile is complete for a team when its
// requirement is met, several teams may complete the same tile, and the final score is tiles
// completed plus lines completed.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import { findGameById } from '../src/worker/db/games';
import { loadTiles } from '../src/worker/db/tiles';
import { classicStandings, recomputeTeam } from '../src/worker/scoring/replay';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { assignTeam, seedGame, seedTiles, tileProgress, type SeedTile } from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

/** A game with a board and players already on teams. */
const setUp = async (options: {
  tiles: SeedTile[];
  players: { hash: string; name: string; team: 0 | 1 }[];
  backfillPolicy?: 'COUNT' | 'IGNORE' | 'FLAG_ONLY';
  boardRows?: number;
  boardCols?: number;
  trackedMetrics?: string[];
}) => {
  const game = await seedGame(env.DB, {
    backfillPolicy: options.backfillPolicy ?? 'COUNT',
    trackedMetrics: options.trackedMetrics ?? [
      'kc.vorkath',
      'kc.zulrah',
      'time.chambers_of_xeric',
      'drop.*',
      'collection_log.*',
    ],
  });

  const tileIds = await seedTiles(env.DB, game.id, options.tiles);

  const clients: Record<string, SimulatedClient> = {};
  for (const player of options.players) {
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: player.hash, displayName: player.name, gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, player.hash, game.teams[player.team]!.id);
    clients[player.name] = client;
  }

  return { game, tileIds, clients };
};

describe('SUM tiles', () => {
  it('accumulates credited kills and completes at the target', async () => {
    const { game, tileIds, clients } = await setUp({
      tiles: [{ row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 }],
      players: [{ hash: '-10001', name: 'Ted', team: 0 }],
    });

    const ted = clients['Ted']!;
    const tile = tileIds[0]!;
    const sharks = game.teams[0]!.id;

    await ted.sendOne(await ted.player.kill('Vorkath'));
    expect(await tileProgress(env.DB, game.id, tile, sharks)).toMatchObject({
      score: 1,
      complete: false,
    });

    await ted.sendOne(await ted.player.kill('Vorkath'));
    await ted.sendOne(await ted.player.kill('Vorkath'));

    expect(await tileProgress(env.DB, game.id, tile, sharks)).toMatchObject({
      score: 3,
      complete: true,
    });
  });

  it('sums contributions from several players on the same team', async () => {
    const { game, tileIds, clients } = await setUp({
      tiles: [{ row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 4 }],
      players: [
        { hash: '-10002', name: 'Ted', team: 0 },
        { hash: '-10003', name: 'Rita', team: 0 },
      ],
    });

    for (let i = 0; i < 2; i++) {
      await clients['Ted']!.sendOne(await clients['Ted']!.player.kill('Vorkath'));
      await clients['Rita']!.sendOne(await clients['Rita']!.player.kill('Vorkath'));
    }

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      score: 4,
      complete: true,
    });
  });

  it('sums across every metric a tile names', async () => {
    const { game, tileIds, clients } = await setUp({
      tiles: [
        { row: 0, col: 0, metrics: ['kc.vorkath', 'kc.zulrah'], aggregate: 'SUM', target: 2 },
      ],
      players: [{ hash: '-10004', name: 'Ted', team: 0 }],
    });

    const ted = clients['Ted']!;
    await ted.sendOne(await ted.player.kill('Vorkath'));
    await ted.sendOne(await ted.player.kill('Zulrah'));

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      complete: true,
    });
  });

  // In CLASSIC every team works the same board independently.
  it('lets both teams complete the same tile', async () => {
    const { game, tileIds, clients } = await setUp({
      tiles: [{ row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 1 }],
      players: [
        { hash: '-10005', name: 'Ted', team: 0 },
        { hash: '-10006', name: 'Manta', team: 1 },
      ],
    });

    await clients['Ted']!.sendOne(await clients['Ted']!.player.kill('Vorkath'));
    await clients['Manta']!.sendOne(await clients['Manta']!.player.kill('Vorkath'));

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      complete: true,
    });
    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[1]!.id)).toMatchObject({
      complete: true,
    });
  });

  it('keeps one team’s progress off another team’s tile', async () => {
    const { game, tileIds, clients } = await setUp({
      tiles: [{ row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 1 }],
      players: [{ hash: '-10007', name: 'Ted', team: 0 }],
    });

    await clients['Ted']!.sendOne(await clients['Ted']!.player.kill('Vorkath'));

    const rivals = await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[1]!.id);
    expect(rivals?.complete ?? false).toBe(false);
  });
});

describe('UNIQUE tiles', () => {
  it('counts distinct metrics rather than quantity', async () => {
    const { game, tileIds, clients } = await setUp({
      tiles: [
        {
          row: 0,
          col: 0,
          metrics: ['drop.abyssal_whip', 'drop.dragon_pickaxe', 'drop.granite_maul'],
          aggregate: 'UNIQUE',
          target: 2,
        },
      ],
      players: [{ hash: '-10008', name: 'Ted', team: 0 }],
    });

    const ted = clients['Ted']!;
    const progress = () => tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id);

    // Five of the same whip is still one distinct item.
    await ted.sendOne(await ted.player.drop(4151, 'Abyssal whip', 'Abyssal demon', 5));
    expect(await progress()).toMatchObject({ score: 1, complete: false });

    await ted.sendOne(await ted.player.drop(11920, 'Dragon pickaxe', 'Callisto'));
    expect(await progress()).toMatchObject({ score: 2, complete: true });
  });

  it('counts breadth under a wildcard', async () => {
    const { game, tileIds, clients } = await setUp({
      tiles: [{ row: 0, col: 0, metrics: ['collection_log.*'], aggregate: 'UNIQUE', target: 3 }],
      players: [{ hash: '-10009', name: 'Ted', team: 0 }],
    });

    const ted = clients['Ted']!;
    for (const item of ['Dragon pickaxe', 'Abyssal whip', 'Twisted bow']) {
      await ted.sendOne(await ted.player.collectionLog(item));
    }

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      score: 3,
      complete: true,
    });
  });
});

describe('MIN_DURATION tiles', () => {
  it('completes on any run and keeps the fastest', async () => {
    const { game, tileIds, clients } = await setUp({
      tiles: [
        {
          row: 0,
          col: 0,
          metrics: ['time.chambers_of_xeric'],
          aggregate: 'MIN_DURATION',
          target: null,
        },
      ],
      players: [{ hash: '-10010', name: 'Ted', team: 0 }],
    });

    const ted = clients['Ted']!;
    const progress = () => tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id);

    await ted.sendOne(await ted.player.duration('Chambers of Xeric', 200_000));
    expect(await progress()).toMatchObject({ complete: true, bestDurationMs: 200_000 });

    // Lower is better, so a faster run replaces it and a slower one does not.
    await ted.sendOne(await ted.player.duration('Chambers of Xeric', 150_000));
    expect(await progress()).toMatchObject({ bestDurationMs: 150_000 });

    await ted.sendOne(await ted.player.duration('Chambers of Xeric', 300_000));
    expect(await progress()).toMatchObject({ bestDurationMs: 150_000 });
  });
});

describe('backfill policy end to end', () => {
  const playSixOffPlugin = async (policy: 'COUNT' | 'IGNORE') => {
    const { game, tileIds, clients } = await setUp({
      tiles: [{ row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 100 }],
      players: [{ hash: `-1001${policy === 'COUNT' ? 1 : 2}`, name: 'Morgan', team: 0 }],
      backfillPolicy: policy,
    });

    const morgan = clients['Morgan']!;
    await morgan.sendOne(await morgan.player.kill('Vorkath'));
    morgan.player.playOffPlugin('kc.vorkath', 6);
    await morgan.sendOne(await morgan.player.kill('Vorkath'));

    return tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id);
  };

  it('COUNT credits the whole gap', async () => {
    // One reported, then a jump from 1 to 8: seven more credited.
    expect(await playSixOffPlugin('COUNT')).toMatchObject({ score: 8 });
  });

  // Play on mobile with the plugin off, then log in at the end and dump the lot.
  it('IGNORE credits only what the plugin actually watched', async () => {
    expect(await playSixOffPlugin('IGNORE')).toMatchObject({ score: 2 });
  });
});

describe('retroactive attribution', () => {
  // A player who syncs before the admin has finished the roster is accepted, and their events are
  // stored with no team. Assigning them must bring the whole history with it.
  it('credits a player’s earlier events to the team they are later assigned to', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const tileIds = await seedTiles(env.DB, game.id, [
      { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 },
    ]);

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-10013', displayName: 'Early', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    for (let i = 0; i < 3; i++) {
      expect((await client.sendOne(await client.player.kill('Vorkath'))).accepted).toBe(true);
    }

    const sharks = game.teams[0]!.id;
    expect(await tileProgress(env.DB, game.id, tileIds[0]!, sharks)).toBeNull();

    await assignTeam(env.DB, game.id, '-10013', sharks);
    await recomputeTeam(env.DB, game.id, sharks);

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, sharks)).toMatchObject({
      score: 3,
      complete: true,
    });
  });
});

describe('standings', () => {
  it('scores tiles completed plus lines completed', async () => {
    const tiles: SeedTile[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        tiles.push({ row, col, metrics: ['kc.vorkath'], aggregate: 'SUM', target: (row + 1) * 100 });
      }
    }
    // The top row needs 100 each; make it reachable by targeting 1 instead.
    tiles[0] = { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 1 };
    tiles[1] = { row: 0, col: 1, metrics: ['kc.zulrah'], aggregate: 'SUM', target: 1 };
    tiles[2] = { row: 0, col: 2, metrics: ['collection_log.*'], aggregate: 'UNIQUE', target: 1 };

    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath', 'kc.zulrah', 'collection_log.*'] });
    await env.DB.prepare('UPDATE games SET board_rows = 3, board_cols = 3 WHERE id = ?')
      .bind(game.id)
      .run();
    await seedTiles(env.DB, game.id, tiles);

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-10014', displayName: 'Liner', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, '-10014', game.teams[0]!.id);

    await client.sendOne(await client.player.kill('Vorkath'));
    await client.sendOne(await client.player.kill('Zulrah'));
    await client.sendOne(await client.player.collectionLog('Twisted bow'));

    const stored = await findGameById(env.DB, game.id);
    const standings = await classicStandings(env.DB, stored!, await loadTiles(env.DB, game.id));
    const sharks = standings.find((entry) => entry.teamId === game.teams[0]!.id);

    // Three tiles completed, which is also the whole top row.
    expect(sharks).toMatchObject({ tilesComplete: 3, linesComplete: 1, score: 4 });
  });
});
