// The admin surface.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import type { AdminPlayer } from '../src/worker/db/admin';
import { hashPassword } from '../src/worker/lib/password';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { seedGame, seedTiles, tileProgress } from './fixtures';

const BASE = 'https://bingo.test';
const PASSWORD = 'a-good-long-admin-password';

let testEnv: Env;
let cookie: string;

beforeAll(async () => {
  testEnv = {
    ...env,
    SIGNING_KEY: 'test-signing-key',
    ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD),
  } as Env;

  const response = await app.fetch(
    new Request(`${BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    }),
    testEnv,
  );

  cookie = (response.headers.get('Set-Cookie') ?? '').split(';')[0] as string;
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

const admin = async (path: string, init: RequestInit = {}): Promise<Response> =>
  app.fetch(
    new Request(`${BASE}/api/admin${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(init.headers ?? {}) },
    }),
    testEnv,
  );

const json = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await admin(path, init);
  expect(response.status).toBeLessThan(400);
  return (await response.json()) as T;
};

describe('access', () => {
  it('refuses every admin route without a session', async () => {
    for (const path of ['/games', '/games/g_1/roster', '/games/g_1/flags']) {
      const response = await app.fetch(new Request(`${BASE}/api/admin${path}`), testEnv);
      expect(response.status).toBe(401);
    }
  });
});

/**
 * A complete game, which is the only kind that can be created.
 *
 * `POST /games` writes the whole thing or nothing — the panel drafts it in the browser first — so
 * every test that creates one has to hand over a board and its teams.
 */
const fullBoard = (rows = 5, cols = 5) =>
  Array.from({ length: rows }).flatMap((_, row) =>
    Array.from({ length: cols }).map((__, col) => ({
      row,
      col,
      label: `Tile ${row + 1}-${col + 1}`,
      requirement: { metrics: ['kc.vorkath'], aggregate: 'SUM', target: 1 },
    })),
  );

const newGame = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'Clan Bingo #5',
    mode: 'CLASSIC',
    startsAt: Date.now() + 60_000,
    boardRows: 5,
    boardCols: 5,
    tiles: fullBoard(),
    teams: [
      { name: 'The Sharks', colour: '#3b82f6' },
      { name: 'The Manta Rays', colour: '#ef4444' },
    ],
    ...over,
  });

describe('games', () => {
  it('creates a game with a join code, not started', async () => {
    const created = await json<{ id: string; joinCode: string }>('/games', {
      method: 'POST',
      body: newGame(),
    });

    expect(created.joinCode).toMatch(/^[A-Z]+-[A-Z]+-\d\d$/);

    const detail = await json<{ game: { state: string; backfillPolicy: string } }>(
      `/games/${created.id}`,
    );

    expect(detail.game.state).toBe('UPCOMING');
    // Crediting off-plugin play is fine over a week-long classic event.
    expect(detail.game.backfillPolicy).toBe('COUNT');
  });

  it('defaults a control game to ignoring backfill', async () => {
    const created = await json<{ id: string }>('/games', {
      method: 'POST',
      body: newGame({ name: 'Live final', mode: 'CONTROL', winCondition: 'FIRST_LINE' }),
    });

    const detail = await json<{ game: { backfillPolicy: string } }>(`/games/${created.id}`);
    expect(detail.game.backfillPolicy).toBe('IGNORE');
  });

  it('refuses a control game with no win condition', async () => {
    const response = await admin('/games', {
      method: 'POST',
      body: newGame({ name: 'Undecided', mode: 'CONTROL' }),
    });

    expect(response.status).toBe(400);
  });

  it('refuses a game that runs for no time at all', async () => {
    for (const durationMs of [0, -1000, 'soon']) {
      const response = await admin('/games', {
        method: 'POST',
        body: newGame({ name: 'Backwards', durationMs }),
      });

      expect(response.status).toBe(400);
    }
  });

  // The creation form does not ask how long a game runs for — a duration guessed before the board
  // exists is not a decision. A control game is an evening and a classic one is a week.
  it('gives a new game a length that suits its mode', async () => {
    const startsAt = Date.now();

    const classic = await json<{ id: string }>('/games', {
      method: 'POST',
      body: newGame({ name: 'Week long', startsAt }),
    });
    const control = await json<{ id: string }>('/games', {
      method: 'POST',
      body: newGame({
        name: 'One evening',
        mode: 'CONTROL',
        winCondition: 'FIRST_LINE',
        startsAt,
      }),
    });

    const week = await json<{ game: { endsAt: number; endOffsetMs: number } }>(
      `/games/${classic.id}`,
    );
    const evening = await json<{ game: { endsAt: number; endOffsetMs: number } }>(
      `/games/${control.id}`,
    );

    expect(week.game.endOffsetMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(week.game.endsAt).toBe(startsAt + week.game.endOffsetMs);
    expect(evening.game.endOffsetMs).toBe(4 * 60 * 60 * 1000);
  });

  // The one that made an end time worth having two kinds of: an organiser pushing a game back a
  // day should not be told it now ends before it begins.
  it('carries a relative end time along when the start moves', async () => {
    const startsAt = Date.now() + 60 * 60 * 1000;
    const created = await json<{ id: string }>('/games', {
      method: 'POST',
      body: newGame({ name: 'Movable', startsAt, durationMs: 4 * 60 * 60 * 1000 }),
    });

    const day = 24 * 60 * 60 * 1000;
    const moved = await admin(`/games/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ startsAt: startsAt + day }),
    });
    expect(moved.status).toBe(200);

    const detail = await json<{ game: { startsAt: number; endsAt: number } }>(
      `/games/${created.id}`,
    );
    expect(detail.game.startsAt).toBe(startsAt + day);
    expect(detail.game.endsAt).toBe(startsAt + day + 4 * 60 * 60 * 1000);
  });

  it('leaves a pinned end time where it is, and refuses a start that would overtake it', async () => {
    const startsAt = Date.now() + 60 * 60 * 1000;
    const created = await json<{ id: string }>('/games', {
      method: 'POST',
      body: newGame({ name: 'Pinned', startsAt }),
    });

    const endsAt = startsAt + 3 * 60 * 60 * 1000;
    expect(
      (
        await admin(`/games/${created.id}`, { method: 'PATCH', body: JSON.stringify({ endsAt }) })
      ).status,
    ).toBe(200);

    // Pinned now: moving the start no longer drags the end along with it.
    await admin(`/games/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ startsAt: startsAt + 60_000 }),
    });

    const detail = await json<{ game: { endsAt: number; endOffsetMs: number | null } }>(
      `/games/${created.id}`,
    );
    expect(detail.game.endsAt).toBe(endsAt);
    expect(detail.game.endOffsetMs).toBeNull();

    const overtaken = await admin(`/games/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ startsAt: endsAt + 1000 }),
    });
    expect(overtaken.status).toBe(400);
  });

  // The whole point of drafting a game in the browser: what reaches the database is complete, so
  // there is never a game a player can join and find nothing in.
  it('refuses a board with an empty square', async () => {
    const response = await admin('/games', {
      method: 'POST',
      body: newGame({ tiles: fullBoard().slice(0, 24) }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: 'Every square on the board needs a tile.',
    });
  });

  it('refuses a game with fewer than two teams', async () => {
    for (const teams of [[], [{ name: 'Alone', colour: '#3b82f6' }]]) {
      const response = await admin('/games', { method: 'POST', body: newGame({ teams }) });
      expect(response.status).toBe(400);
    }
  });

  it('refuses a tile that could never be completed, naming the square', async () => {
    const tiles = fullBoard();
    tiles[7] = {
      row: 1,
      col: 2,
      label: 'Impossible',
      requirement: { metrics: [], aggregate: 'SUM', target: 3 },
    };

    const response = await admin('/games', { method: 'POST', body: newGame({ tiles }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'IMPOSSIBLE_TILES',
      problems: [{ row: 1, col: 2 }],
    });
  });

  it('writes nothing at all when a creation is refused', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM games').first<{ n: number }>();

    await admin('/games', { method: 'POST', body: newGame({ teams: [] }) });

    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM games').first()).toMatchObject({
      n: before?.n ?? 0,
    });
  });

  // Board, teams and the metric list the board implies, all in the one write.
  it('creates the board, the teams and the tracked metrics together', async () => {
    const tiles = fullBoard();
    tiles[0] = {
      row: 0,
      col: 0,
      label: '3 Zulrah kills',
      requirement: { metrics: ['kc.zulrah'], aggregate: 'SUM', target: 3 },
    };

    const created = await json<{ id: string }>('/games', {
      method: 'POST',
      body: newGame({ tiles }),
    });

    const detail = await json<{
      tiles: unknown[];
      teams: unknown[];
      trackedMetrics: { metricId: string }[];
      setup: { problems: string[] };
    }>(`/games/${created.id}`);

    expect(detail.tiles).toHaveLength(25);
    expect(detail.teams).toHaveLength(2);
    expect(detail.trackedMetrics.map((entry) => entry.metricId).sort()).toEqual([
      'kc.vorkath',
      'kc.zulrah',
    ]);
    expect(detail.setup.problems).toEqual([]);
  });

  it('starts, locks and ends a game, and writes a final board when it ends', async () => {
    const game = await seedGame(env.DB, { state: 'UPCOMING' });
    await seedTiles(env.DB, game.id, [
      { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 1 },
    ]);

    for (const state of ['LIVE', 'LOCKED', 'ENDED']) {
      const response = await admin(`/games/${game.id}/state`, {
        method: 'POST',
        body: JSON.stringify({ state }),
      });
      expect(response.status).toBe(200);
    }

    const snapshot = await env.DB.prepare(
      'SELECT snapshot_json FROM board_snapshots WHERE game_id = ?',
    )
      .bind(game.id)
      .first();

    expect(snapshot).not.toBeNull();
  });

  it('issues a fresh join code on demand', async () => {
    const game = await seedGame(env.DB);
    const { joinCode } = await json<{ joinCode: string }>(`/games/${game.id}/join-code`, {
      method: 'POST',
    });

    expect(joinCode).not.toBe(game.joinCode);
    expect((await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${joinCode}`))).status).toBe(200);
  });
});

describe('the board editor', () => {
  it('saves a board', async () => {
    const game = await seedGame(env.DB);

    const result = await json<{ tiles: number }>(`/games/${game.id}/tiles`, {
      method: 'PUT',
      body: JSON.stringify({
        tiles: [
          {
            row: 0,
            col: 0,
            label: 'Vorkath x3',
            requirement: { metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 },
          },
        ],
      }),
    });

    expect(result.tiles).toBe(1);
  });

  // It must not be possible to save a tile that can never be satisfied — that is only ever
  // discovered by a player grinding at it for a day.
  it('refuses impossible tiles and says which and why', async () => {
    const game = await seedGame(env.DB);

    const response = await admin(`/games/${game.id}/tiles`, {
      method: 'PUT',
      body: JSON.stringify({
        tiles: [
          {
            row: 0,
            col: 0,
            label: 'Fine',
            requirement: { metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 },
          },
          {
            row: 0,
            col: 1,
            label: 'Impossible',
            requirement: { metrics: ['drop.a', 'drop.b'], aggregate: 'UNIQUE', target: 5 },
          },
          {
            row: 1,
            col: 0,
            label: 'Also impossible',
            requirement: { metrics: ['time.cox'], aggregate: 'SUM', target: 2 },
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { problems: { row: number; col: number }[] };
    expect(body.problems).toHaveLength(2);

    // Nothing was written: the whole board is rejected rather than half-saved.
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM tiles WHERE game_id = ?')
      .bind(game.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('rescores the board against the new tiles', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const hash = '-70001';

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: hash, displayName: 'Grinder', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await admin(`/games/${game.id}/roster`);

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    const playerId = roster.players[0]!.id;

    await admin(`/games/${game.id}/players/${playerId}/team`, {
      method: 'POST',
      body: JSON.stringify({ teamId: game.teams[0]!.id }),
    });

    for (let i = 0; i < 3; i++) {
      await client.sendOne(await client.player.kill('Vorkath'));
    }

    await json(`/games/${game.id}/tiles`, {
      method: 'PUT',
      body: JSON.stringify({
        tiles: [
          {
            row: 0,
            col: 0,
            label: 'Vorkath x3',
            requirement: { metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 },
          },
        ],
      }),
    });

    const tile = await env.DB.prepare('SELECT id FROM tiles WHERE game_id = ?')
      .bind(game.id)
      .first<{ id: string }>();

    expect(await tileProgress(env.DB, game.id, tile!.id, game.teams[0]!.id)).toMatchObject({
      score: 3,
      complete: true,
    });
  });
});

describe('tracked metrics and the re-sync warning', () => {
  // The plugin does not poll. A metric added mid-game is observed by nobody until they re-sync.
  it('marks who has not synced since a metric was added', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70010', displayName: 'Stale Stan', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    let roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(roster.players[0]?.needsResync).toBe(false);

    await json(`/games/${game.id}/metrics`, {
      method: 'PUT',
      body: JSON.stringify({
        metrics: [{ metricId: 'kc.vorkath' }, { metricId: 'kc.zulrah' }],
      }),
    });

    roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(roster.players[0]?.needsResync).toBe(true);

    // Re-syncing clears it.
    await client.sync(game.joinCode);
    roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(roster.players[0]?.needsResync).toBe(false);
  });

  // A removed metric is rejected per-event with NOT_TRACKED, which is immediate and harmless.
  it('does not warn when a metric is only removed', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath', 'kc.zulrah'] });
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70011', displayName: 'Fine Fran', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    await json(`/games/${game.id}/metrics`, {
      method: 'PUT',
      body: JSON.stringify({ metrics: [{ metricId: 'kc.vorkath' }] }),
    });

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(roster.players[0]?.needsResync).toBe(false);
  });

  it('preserves an existing re-sync timestamp when no metric is added', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath', 'kc.zulrah'] });
    const changedAt = game.startsAt + 12_345;
    await env.DB.prepare('UPDATE games SET metrics_changed_at = ? WHERE id = ?')
      .bind(changedAt, game.id)
      .run();

    await json(`/games/${game.id}/metrics`, {
      method: 'PUT',
      body: JSON.stringify({ metrics: [{ metricId: 'kc.vorkath' }] }),
    });

    const row = await env.DB.prepare('SELECT metrics_changed_at FROM games WHERE id = ?')
      .bind(game.id)
      .first<{ metrics_changed_at: number | null }>();
    expect(row?.metrics_changed_at).toBe(changedAt);
  });

  it('refuses a metric the plugin could never report', async () => {
    const game = await seedGame(env.DB);

    const response = await admin(`/games/${game.id}/metrics`, {
      method: 'PUT',
      body: JSON.stringify({ metrics: [{ metricId: 'xp.attack' }] }),
    });

    expect(response.status).toBe(400);
  });

  it('offers tracked, observed and wildcard metrics to the requirement builder', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70012', displayName: 'Seen Sam', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await client.sendOne(await client.player.kill('Vorkath'));

    const catalogue = await json<{
      tracked: { metricId: string }[];
      observed: { metric_id: string; seen: number }[];
      wildcards: string[];
    }>(`/games/${game.id}/metric-catalogue`);

    expect(catalogue.tracked.map((entry) => entry.metricId)).toContain('kc.vorkath');
    expect(catalogue.observed[0]).toMatchObject({ metric_id: 'kc.vorkath', seen: 1 });
    expect(catalogue.wildcards).toEqual(['collection_log.*', 'drop.*']);
  });
});

describe('the roster', () => {
  it('shows readiness with each failed check named', async () => {
    const game = await seedGame(env.DB);
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70020', displayName: 'Filtered Phil', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await client.reportReady(false, [
      { id: 'KILL_COUNT_FILTER', satisfied: false },
      { id: 'WORLD_TYPE', satisfied: true },
      { id: 'LOOT_TRACKER', satisfied: true },
    ]);

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    const player = roster.players[0]!;

    expect(player.ready).toBe(false);
    expect(player.checks.filter((check) => !check.satisfied)).toEqual([
      { id: 'KILL_COUNT_FILTER', satisfied: false },
    ]);
  });

  it('reports readiness as unknown for a player who has never said', async () => {
    const game = await seedGame(env.DB);
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70021', displayName: 'Silent Sid', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(roster.players[0]?.ready).toBeNull();
  });

  it('keeps a large account hash exact', async () => {
    const game = await seedGame(env.DB);
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({
        accountHash: '1818775870234376620',
        displayName: 'Big Hash Barry',
        gameId: game.id,
      }),
    );
    await client.sync(game.joinCode);

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(roster.players[0]?.accountHash).toBe('1818775870234376620');
  });

  it('brings a player’s whole history with them when they are assigned', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const tileIds = await seedTiles(env.DB, game.id, [
      { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 },
    ]);

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70022', displayName: 'Early Eric', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    for (let i = 0; i < 3; i++) {
      await client.sendOne(await client.player.kill('Vorkath'));
    }

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toBeNull();

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    await json(`/games/${game.id}/players/${roster.players[0]!.id}/team`, {
      method: 'POST',
      body: JSON.stringify({ teamId: game.teams[0]!.id }),
    });

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      score: 3,
      complete: true,
    });
  });

  // Removal stops them reporting but leaves what they contributed. Erasing a history automatically
  // is the largest possible version of the thing this server does not do.
  it('stops a removed player reporting without erasing their progress', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const tileIds = await seedTiles(env.DB, game.id, [
      { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 1 },
    ]);

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70023', displayName: 'Removed Rob', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    const playerId = roster.players[0]!.id;

    await json(`/games/${game.id}/players/${playerId}/team`, {
      method: 'POST',
      body: JSON.stringify({ teamId: game.teams[0]!.id }),
    });
    await client.sendOne(await client.player.kill('Vorkath'));

    await json(`/games/${game.id}/players/${playerId}/removal`, {
      method: 'POST',
      body: JSON.stringify({ removed: true }),
    });

    expect((await client.sendRaw([await client.player.kill('Vorkath')])).status).toBe(403);
    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      complete: true,
    });
  });
});

describe('join codes', () => {
  it('accepts a code the organiser chose', async () => {
    const created = await json<{ id: string; joinCode: string }>('/games', {
      method: 'POST',
      body: newGame({ name: 'Custom code', joinCode: 'clan-bingo-4' }),
    });

    // Uppercased, because that is how the plugin compares them.
    expect(created.joinCode).toBe('CLAN-BINGO-4');

    // Created means joinable. There is no further step between the two.
    expect(
      (await transport.fetch(new Request(`${BASE}/api/plugin/game?code=clan-bingo-4`))).status,
    ).toBe(200);
  });

  it('refuses a code already in use, and a malformed one', async () => {
    const game = await seedGame(env.DB, { joinCode: 'TAKEN-CODE-01' });

    const duplicate = await admin('/games', {
      method: 'POST',
      body: newGame({ name: 'Clash', joinCode: 'taken-code-01' }),
    });
    expect(duplicate.status).toBe(400);

    const malformed = await admin(`/games/${game.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ joinCode: 'no spaces allowed!' }),
    });
    expect(malformed.status).toBe(400);
  });

  it('changes the code of an existing game', async () => {
    const game = await seedGame(env.DB);

    await json(`/games/${game.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ joinCode: 'RENAMED-99' }),
    });

    expect(
      (await transport.fetch(new Request(`${BASE}/api/plugin/game?code=RENAMED-99`))).status,
    ).toBe(200);
    expect(
      (await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`))).status,
    ).toBe(404);
  });
});

describe('teams', () => {
  it('rejects a missing team id and a team from another game without changing the player', async () => {
    const game = await seedGame(env.DB);
    const other = await seedGame(env.DB);
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70101', displayName: 'Safe Sally', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    const playerId = roster.players[0]!.id;

    const missing = await admin(`/games/${game.id}/players/${playerId}/team`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const foreign = await admin(`/games/${game.id}/players/${playerId}/team`, {
      method: 'POST',
      body: JSON.stringify({ teamId: other.teams[0]!.id }),
    });
    expect(foreign.status).toBe(404);

    const after = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(after.players[0]?.teamId).toBeNull();
  });

  // Deleting a team must not delete anybody's history — team is read at scoring time, so the
  // contributions simply stop landing anywhere until an admin places those players again.
  it('deletes a team and returns its players to no team', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70100', displayName: 'Orphan Olly', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    await json(`/games/${game.id}/players/${roster.players[0]!.id}/team`, {
      method: 'POST',
      body: JSON.stringify({ teamId: game.teams[0]!.id }),
    });
    await client.sendOne(await client.player.kill('Vorkath'));

    await json(`/games/${game.id}/teams/${game.teams[0]!.id}`, { method: 'DELETE' });

    const after = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(after.players[0]?.teamId).toBeNull();
    expect(after.players[0]?.removedAt).toBeNull();

    const detail = await json<{ teams: unknown[] }>(`/games/${game.id}`);
    expect(detail.teams).toHaveLength(1);

    // The event is still in the log, so putting them on a team brings it back.
    const events = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?')
      .bind(game.id)
      .first<{ n: number }>();
    expect(events?.n).toBe(1);
  });

  it('404s deleting a team from another game', async () => {
    const game = await seedGame(env.DB);
    const other = await seedGame(env.DB);

    const response = await admin(`/games/${game.id}/teams/${other.teams[0]!.id}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(404);
  });
});

describe('saving a board tracks what it needs', () => {
  // An organiser building a board should not also maintain a parallel list of tracked metrics.
  it('sets tracked metrics from the tiles', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });

    const result = await json<{ added: string[]; removed: string[] }>(`/games/${game.id}/tiles`, {
      method: 'PUT',
      body: JSON.stringify({
        tiles: [
          {
            row: 0,
            col: 0,
            label: 'Zulrah',
            requirement: { metrics: ['kc.zulrah'], aggregate: 'SUM', target: 3 },
          },
          {
            row: 0,
            col: 1,
            label: 'Any drop',
            requirement: { metrics: ['drop.*'], aggregate: 'SUM', target: 1 },
          },
        ],
      }),
    });

    expect(result.added.sort()).toEqual(['drop.*', 'kc.zulrah']);
    expect(result.removed).toEqual(['kc.vorkath']);

    const detail = await json<{ trackedMetrics: { metricId: string }[] }>(`/games/${game.id}`);
    expect(detail.trackedMetrics.map((entry) => entry.metricId).sort()).toEqual([
      'drop.*',
      'kc.zulrah',
    ]);

    // And the plugin is told, so it starts watching for them.
    const config = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`));
    expect(((await config.json()) as { trackedMetrics: string[] }).trackedMetrics.sort()).toEqual([
      'drop.*',
      'kc.zulrah',
    ]);
  });

  it('warns the roster only when a metric was added', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath', 'kc.zulrah'] });
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-70110', displayName: 'Synced Sam', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    // Narrowing the board to a subset removes metrics and adds none.
    await json(`/games/${game.id}/tiles`, {
      method: 'PUT',
      body: JSON.stringify({
        tiles: [
          {
            row: 0,
            col: 0,
            label: 'Vorkath',
            requirement: { metrics: ['kc.vorkath'], aggregate: 'SUM', target: 1 },
          },
        ],
      }),
    });

    let roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(roster.players[0]?.needsResync).toBe(false);

    // Adding one does strand them until they sync again.
    await json(`/games/${game.id}/tiles`, {
      method: 'PUT',
      body: JSON.stringify({
        tiles: [
          {
            row: 0,
            col: 0,
            label: 'Hydra',
            requirement: { metrics: ['kc.alchemical_hydra'], aggregate: 'SUM', target: 1 },
          },
        ],
      }),
    });

    roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(roster.players[0]?.needsResync).toBe(true);
  });
});

describe('game metric settings', () => {
  it('turns typed-in events off and on', async () => {
    const game = await seedGame(env.DB);

    expect((await json<{ game: { manualEntryAllowed: boolean } }>(`/games/${game.id}`)).game
      .manualEntryAllowed).toBe(true);

    await json(`/games/${game.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ manualEntryAllowed: false }),
    });

    expect((await json<{ game: { manualEntryAllowed: boolean } }>(`/games/${game.id}`)).game
      .manualEntryAllowed).toBe(false);

    // And the plugin is told, so it stops offering the control.
    const config = await transport.fetch(
      new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`),
    );
    expect(((await config.json()) as { manualEntryAllowed: boolean }).manualEntryAllowed).toBe(false);
  });

  it('saves value rules and hands them to the plugin', async () => {
    const game = await seedGame(env.DB);

    await json(`/games/${game.id}/drop-value-rules`, {
      method: 'PUT',
      body: JSON.stringify({
        rules: [
          {
            metricId: 'drop.worth_1m_plus',
            label: 'Drops worth 1m or more',
            minValue: 1000000,
            maxValue: null,
            valuation: 'GRAND_EXCHANGE',
            counts: 'ITEMS',
          },
        ],
      }),
    });

    const detail = await json<{ dropValueRules: { metricId: string }[] }>(`/games/${game.id}`);
    expect(detail.dropValueRules).toHaveLength(1);

    const config = await transport.fetch(
      new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`),
    );
    const body = (await config.json()) as { dropValueRules: { metricId: string }[] };
    expect(body.dropValueRules[0]?.metricId).toBe('drop.worth_1m_plus');
  });

  it('refuses a rule metric outside the drop namespace, or a wildcard', async () => {
    const game = await seedGame(env.DB);

    for (const metricId of ['kc.vorkath', 'drop.*', 'nonsense']) {
      const response = await admin(`/games/${game.id}/drop-value-rules`, {
        method: 'PUT',
        body: JSON.stringify({ rules: [{ metricId }] }),
      });
      expect(response.status).toBe(400);
    }
  });

  // A rule that could never fire looks exactly like a player not getting the drop.
  it('refuses a band that could never fire', async () => {
    const game = await seedGame(env.DB);

    const response = await admin(`/games/${game.id}/drop-value-rules`, {
      method: 'PUT',
      body: JSON.stringify({
        rules: [{ metricId: 'drop.impossible', minValue: 5000000, maxValue: 1000000 }],
      }),
    });

    expect(response.status).toBe(400);
  });
});

describe('scheduling the start', () => {
  // The plugin schedules exactly one sync at the advertised start and does not poll, so a change
  // inside the lock window reaches nobody who has already scheduled theirs.
  it('lets the start move while it is comfortably ahead', async () => {
    const game = await seedGame(env.DB, {
      state: 'UPCOMING',
      startsAt: Date.now() + 3_600_000,
      endsAt: Date.now() + 7_200_000,
    });

    const moved = Date.now() + 1_800_000;
    await json(`/games/${game.id}`, { method: 'PATCH', body: JSON.stringify({ startsAt: moved }) });

    const detail = await json<{ game: { startsAt: number } }>(`/games/${game.id}`);
    expect(detail.game.startsAt).toBe(moved);
  });

  it('refuses to move a start that is seconds away', async () => {
    const game = await seedGame(env.DB, {
      state: 'UPCOMING',
      startsAt: Date.now() + 3000,
      endsAt: Date.now() + 3_600_000,
    });

    // Comfortably before endsAt, so the only thing that can refuse this is the lock.
    const response = await admin(`/games/${game.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ startsAt: Date.now() + 60_000 }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toContain('locked');
  });

  it('refuses to move the start of a game already running', async () => {
    const game = await seedGame(env.DB, {
      state: 'LIVE',
      startsAt: Date.now() - 60_000,
      endsAt: Date.now() + 3_600_000,
    });

    const response = await admin(`/games/${game.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ startsAt: Date.now() + 60_000 }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toContain('already started');
  });

  // Everything else about a locked game is still editable.
  it('still allows other edits once the start is locked', async () => {
    const game = await seedGame(env.DB, { state: 'LIVE' });

    await json(`/games/${game.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed mid-event' }),
    });

    expect((await json<{ game: { name: string } }>(`/games/${game.id}`)).game.name).toBe(
      'Renamed mid-event',
    );
  });
});

describe('naming a player the plugin never named', () => {
  it('lets an admin set the name by hand', async () => {
    const game = await seedGame(env.DB);

    const res = await transport.fetch(
      new Request(`${BASE}/api/plugin/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode: game.joinCode,
          accountHash: '6381032651629395922',
          displayName: '',
          pluginVersion: '0.1.0',
          schemaVersion: 1,
        }),
      }),
    );
    expect(res.status).toBe(200);

    const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(roster.players[0]?.displayName).toBe('');

    await json(`/games/${game.id}/players/${roster.players[0]!.id}/name`, {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Safespot Ted' }),
    });

    const after = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
    expect(after.players[0]?.displayName).toBe('Safespot Ted');
  });

  // The plugin captures the name once, at session start, when the client often does not have it.
  // The envelope carries the same field, so an event is the other chance to learn it.
  it('picks a name up off an event when the sync had none', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-90001', displayName: '', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    expect((await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`)).players[0]
      ?.displayName).toBe('');

    // A later session does know the name.
    const named = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-90001', displayName: 'Late Larry', gameId: game.id }),
    );
    named.setToken(client.playerToken);
    await named.sendOne(await named.player.kill('Vorkath'));

    expect((await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`)).players[0]
      ?.displayName).toBe('Late Larry');
  });

  it('does not let an event overwrite a name already known', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-90002', displayName: 'Real Name', gameId: game.id }),
    );
    await client.sync(game.joinCode);

    const impostor = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-90002', displayName: 'Something Else', gameId: game.id }),
    );
    impostor.setToken(client.playerToken);
    await impostor.sendOne(await impostor.player.kill('Vorkath'));

    expect((await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`)).players[0]
      ?.displayName).toBe('Real Name');
  });
});
