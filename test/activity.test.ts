// The activity feed, tile detail and evidence — what the public board reads over HTTP.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import type { ActivityEntry, ActivityPage, TileDetail } from '../src/worker/db/activity';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { assignTeam, seedGame, seedTiles, type SeedTile } from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

const BOARD: SeedTile[] = [
  { row: 0, col: 0, label: 'Vorkath x3', metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 },
  { row: 0, col: 1, label: 'Any drop', metrics: ['drop.*'], aggregate: 'SUM', target: 2 },
  {
    row: 1,
    col: 0,
    label: 'Fastest CoX',
    metrics: ['time.chambers_of_xeric'],
    aggregate: 'MIN_DURATION',
    target: null,
  },
];

const setUp = async (options: { withCamera?: boolean } = {}) => {
  const game = await seedGame(env.DB, {
    trackedMetrics: ['kc.vorkath', 'kc.zulrah', 'time.chambers_of_xeric', 'drop.*'],
  });
  const tileIds = await seedTiles(env.DB, game.id, BOARD);

  const hash = `-50${Date.now() % 100000}`;
  const client = new SimulatedClient(
    transport,
    BASE,
    new SimulatedPlayer({
      accountHash: hash,
      displayName: 'Safespot Ted',
      gameId: game.id,
      screenshotMediaType: options.withCamera === true ? 'image/jpeg' : null,
    }),
  );
  await client.sync(game.joinCode);
  await assignTeam(env.DB, game.id, hash, game.teams[0]!.id);

  return { game, tileIds, client };
};

const feed = async (gameId: string, query = ''): Promise<ActivityPage> => {
  const response = await transport.fetch(
    new Request(`${BASE}/api/board/${gameId}/activity${query}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ActivityPage;
};

describe('the activity feed', () => {
  it('reports who did what, on which tile, and when', async () => {
    const { game, tileIds, client } = await setUp();

    await client.sendOne(await client.player.kill('Vorkath'));

    const { entries } = await feed(game.id);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      playerName: 'Safespot Ted',
      teamId: game.teams[0]!.id,
      metricId: 'kc.vorkath',
      credited: 1,
      what: 'Vorkath kill',
      hasScreenshot: false,
    });
    expect(entries[0]?.tiles).toEqual([{ tileId: tileIds[0]!, label: 'Vorkath x3' }]);
    expect(entries[0]?.at).toBeGreaterThan(0);
  });

  it('reads each metric type into something a player would recognise', async () => {
    const { game, client } = await setUp();

    await client.sendOne(await client.player.drop(4151, 'Abyssal whip', 'Abyssal demon'));
    await client.sendOne(await client.player.drop(560, 'Death rune', 'Abyssal demon', 50));
    await client.sendOne(await client.player.duration('Chambers of Xeric', 154_800, true));

    const { entries } = await feed(game.id);
    const said = entries.map((entry) => entry.what);

    expect(said).toContain('Abyssal whip');
    expect(said).toContain('Death rune x50');
    expect(said).toContain('Chambers of Xeric in 2:34 (personal best)');
  });

  it('is newest first', async () => {
    const { game, client } = await setUp();

    await client.sendOne(await client.player.kill('Vorkath'));
    await client.sendOne(await client.player.drop(4151, 'Abyssal whip', 'Abyssal demon'));

    const { entries } = await feed(game.id);

    expect(entries[0]?.what).toBe('Abyssal whip');
    expect(entries[1]?.what).toBe('Vorkath kill');
  });

  // The feed is what the board scores, not everything the plugin sent.
  it('leaves out a tracked metric that is on no tile', async () => {
    const { game, client } = await setUp();

    await client.sendOne(await client.player.kill('Zulrah'));
    await client.sendOne(await client.player.kill('Vorkath'));

    const { entries } = await feed(game.id);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.metricId).toBe('kc.vorkath');
  });

  it('shows what a backfill policy withheld', async () => {
    const game = await seedGame(env.DB, {
      backfillPolicy: 'IGNORE',
      trackedMetrics: ['kc.vorkath'],
    });
    await seedTiles(env.DB, game.id, BOARD);

    const hash = '-5099';
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: hash, displayName: 'Mobile Morgan', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, hash, game.teams[0]!.id);

    await client.sendOne(await client.player.kill('Vorkath'));
    client.player.playOffPlugin('kc.vorkath', 6);
    await client.sendOne(await client.player.kill('Vorkath'));

    const { entries } = await feed(game.id);

    // Credited one, but the board can show that seven were implied.
    expect(entries[0]).toMatchObject({ credited: 1, derivedDelta: 7 });
  });

  it('pages backwards through a long feed without repeating or skipping', async () => {
    const { game, client } = await setUp();

    for (let i = 0; i < 12; i++) {
      await client.sendOne(await client.player.kill('Vorkath'));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page: ActivityPage = await feed(
        game.id,
        `?limit=5${cursor === null ? '' : `&before=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...page.entries.map((entry: ActivityEntry) => entry.eventId));
      cursor = page.cursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('is empty for a board with no tiles', async () => {
    const game = await seedGame(env.DB);
    const { entries, cursor } = await feed(game.id);

    expect(entries).toEqual([]);
    expect(cursor).toBeNull();
  });

  it('404s a game that does not exist', async () => {
    const response = await transport.fetch(new Request(`${BASE}/api/board/g_nope/activity`));
    expect(response.status).toBe(404);
  });
});

describe('tile detail', () => {
  it('breaks a tile down by player', async () => {
    const { game, tileIds, client } = await setUp();

    const second = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-5200', displayName: 'Rangeta Rita', gameId: game.id }),
    );
    await second.sync(game.joinCode);
    await assignTeam(env.DB, game.id, '-5200', game.teams[1]!.id);

    await client.sendOne(await client.player.kill('Vorkath'));
    await client.sendOne(await client.player.kill('Vorkath'));
    await second.sendOne(await second.player.kill('Vorkath'));

    const response = await transport.fetch(
      new Request(`${BASE}/api/board/${game.id}/tiles/${tileIds[0]}`),
    );
    const detail = (await response.json()) as TileDetail;

    expect(detail.label).toBe('Vorkath x3');
    expect(detail.contributors).toEqual([
      {
        playerName: 'Safespot Ted',
        teamId: game.teams[0]!.id,
        credited: 2,
        events: 2,
        bestDurationMs: null,
      },
      {
        playerName: 'Rangeta Rita',
        teamId: game.teams[1]!.id,
        credited: 1,
        events: 1,
        bestDurationMs: null,
      },
    ]);
  });

  it('reports the fastest run on a duration tile', async () => {
    const { game, tileIds, client } = await setUp();

    await client.sendOne(await client.player.duration('Chambers of Xeric', 200_000));
    await client.sendOne(await client.player.duration('Chambers of Xeric', 150_000));

    const response = await transport.fetch(
      new Request(`${BASE}/api/board/${game.id}/tiles/${tileIds[2]}`),
    );
    const detail = (await response.json()) as TileDetail;

    expect(detail.contributors[0]?.bestDurationMs).toBe(150_000);
  });

  it('lists the evidence held for a tile', async () => {
    const { game, tileIds, client } = await setUp({ withCamera: true });

    await client.sendOne(await client.player.kill('Vorkath'));
    await client.sendOne(await client.player.kill('Vorkath'));

    const response = await transport.fetch(
      new Request(`${BASE}/api/board/${game.id}/tiles/${tileIds[0]}`),
    );
    const detail = (await response.json()) as TileDetail;

    expect(detail.evidence).toHaveLength(2);
    expect(detail.evidence[0]?.playerName).toBe('Safespot Ted');
  });

  it('404s a tile on another board', async () => {
    const { game } = await setUp();
    const response = await transport.fetch(
      new Request(`${BASE}/api/board/${game.id}/tiles/tile_nope`),
    );

    expect(response.status).toBe(404);
  });
});

describe('serving evidence', () => {
  it('returns the image with its own content type', async () => {
    const { game, client } = await setUp({ withCamera: true });

    const envelope = await client.player.kill('Vorkath');
    await client.sendOne(envelope);

    const response = await transport.fetch(
      new Request(`${BASE}/api/board/${game.id}/screenshots/${envelope.eventId}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    // The image for an event never changes.
    expect(response.headers.get('Cache-Control')).toContain('immutable');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it('404s an event with no image', async () => {
    const { game, client } = await setUp();

    const envelope = await client.player.kill('Vorkath');
    await client.sendOne(envelope);

    const response = await transport.fetch(
      new Request(`${BASE}/api/board/${game.id}/screenshots/${envelope.eventId}`),
    );

    expect(response.status).toBe(404);
  });

  // The key is scoped by game, so knowing an event id from one game reveals nothing about another.
  it('will not serve an image across games', async () => {
    const { client } = await setUp({ withCamera: true });
    const other = await seedGame(env.DB);

    const envelope = await client.player.kill('Vorkath');
    await client.sendOne(envelope);

    const response = await transport.fetch(
      new Request(`${BASE}/api/board/${other.id}/screenshots/${envelope.eventId}`),
    );

    expect(response.status).toBe(404);
  });
});
