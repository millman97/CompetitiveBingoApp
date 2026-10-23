// The flag queue, manual adjustment and evidence review.
//
// The rule the whole validation design turns on: the server records and flags, and an admin
// decides. Nothing here happens automatically, and nothing here moves a score without a reason
// attached to it.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import type { AdminPlayer, PlayerFlags } from '../src/worker/db/admin';
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

/** A game with one tile, one player on a team, and whatever backfill policy the test wants. */
const setUp = async (options: { backfillPolicy?: 'COUNT' | 'IGNORE' | 'FLAG_ONLY' } = {}) => {
  const game = await seedGame(env.DB, {
    trackedMetrics: ['kc.vorkath'],
    backfillPolicy: options.backfillPolicy ?? 'FLAG_ONLY',
  });
  const tileIds = await seedTiles(env.DB, game.id, [
    { row: 0, col: 0, label: 'Vorkath x50', metrics: ['kc.vorkath'], aggregate: 'SUM', target: 50 },
  ]);

  const hash = `-71${Date.now() % 100000}`;
  const client = new SimulatedClient(
    transport,
    BASE,
    new SimulatedPlayer({
      accountHash: hash,
      displayName: 'Mobile Morgan',
      gameId: game.id,
      screenshotMediaType: 'image/jpeg',
    }),
  );
  await client.sync(game.joinCode);

  const roster = await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`);
  const playerId = roster.players[0]!.id;

  await json(`/games/${game.id}/players/${playerId}/team`, {
    method: 'POST',
    body: JSON.stringify({ teamId: game.teams[0]!.id }),
  });

  return { game, tileIds, client, playerId };
};

describe('the flag queue', () => {
  it('groups flags by player and shows what the event was worth', async () => {
    const { game, client } = await setUp();

    await client.sendOne(await client.player.kill('Vorkath'));
    client.player.playOffPlugin('kc.vorkath', 6);
    await client.sendOne(await client.player.kill('Vorkath'));

    const queue = await json<PlayerFlags[]>(`/games/${game.id}/flags`);

    expect(queue).toHaveLength(1);
    expect(queue[0]?.playerName).toBe('Mobile Morgan');

    const flag = queue[0]!.flags[0]!;
    expect(flag.kind).toBe('BACKFILL');
    expect(flag.metricId).toBe('kc.vorkath');
    // Seven implied, seven credited under FLAG_ONLY — the admin can see both.
    expect(flag.derivedDelta).toBe(7);
    expect(flag.credited).toBe(7);
    expect(flag.hasScreenshot).toBe(true);
    expect(flag.resolution).toBeNull();
  });

  it('hides resolved flags unless asked for them', async () => {
    const { game, client } = await setUp();

    await client.sendOne(await client.player.kill('Vorkath'));
    client.player.playOffPlugin('kc.vorkath', 6);
    await client.sendOne(await client.player.kill('Vorkath'));

    const open = await json<PlayerFlags[]>(`/games/${game.id}/flags`);
    const flagId = open[0]!.flags[0]!.id;

    await json(`/games/${game.id}/flags/${flagId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: 'DISMISSED' }),
    });

    expect(await json<PlayerFlags[]>(`/games/${game.id}/flags`)).toHaveLength(0);
    expect(
      (await json<PlayerFlags[]>(`/games/${game.id}/flags?resolved=true`))[0]?.flags[0],
    ).toMatchObject({ resolution: 'DISMISSED' });
  });

  // Dismissing is a judgement that nothing was wrong. It must not move anything.
  it('changes no score when a flag is dismissed', async () => {
    const { game, tileIds, client } = await setUp();

    await client.sendOne(await client.player.kill('Vorkath'));
    client.player.playOffPlugin('kc.vorkath', 6);
    await client.sendOne(await client.player.kill('Vorkath'));

    const before = await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id);

    const queue = await json<PlayerFlags[]>(`/games/${game.id}/flags`);
    await json(`/games/${game.id}/flags/${queue[0]!.flags[0]!.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: 'DISMISSED' }),
    });

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toEqual(before);
  });

  it('credits the withheld amount when an admin decides it was honest', async () => {
    const { game, tileIds, client } = await setUp({ backfillPolicy: 'IGNORE' });

    await client.sendOne(await client.player.kill('Vorkath'));
    client.player.playOffPlugin('kc.vorkath', 6);
    await client.sendOne(await client.player.kill('Vorkath'));

    // IGNORE credited one of the seven.
    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      score: 2,
    });

    // IGNORE does not raise the flag itself, so this is the manual adjustment path instead.
    await json(`/games/${game.id}/adjustments`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: (await json<{ players: AdminPlayer[] }>(`/games/${game.id}/roster`)).players[0]!.id,
        metricId: 'kc.vorkath',
        delta: 6,
        reason: 'Checked the hiscores; the six were real.',
      }),
    });

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      score: 8,
    });
  });

  it('discredits by writing a negative adjustment', async () => {
    const { game, tileIds, client } = await setUp();

    // One kill establishes the baseline; the gap after it is what backfill means.
    await client.sendOne(await client.player.kill('Vorkath'));
    client.player.playOffPlugin('kc.vorkath', 6);
    await client.sendOne(await client.player.kill('Vorkath'));

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      score: 8,
    });

    const queue = await json<PlayerFlags[]>(`/games/${game.id}/flags`);

    await json(`/games/${game.id}/flags/${queue[0]!.flags[0]!.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        resolution: 'DISCREDITED',
        metricId: 'kc.vorkath',
        delta: 6,
        reason: 'Admitted to logging in on mobile with the plugin off.',
      }),
    });

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      score: 2,
    });
  });

  it('will not move a score without a reason', async () => {
    const { game, client } = await setUp();

    await client.sendOne(await client.player.kill('Vorkath'));
    client.player.playOffPlugin('kc.vorkath', 6);
    await client.sendOne(await client.player.kill('Vorkath'));

    const queue = await json<PlayerFlags[]>(`/games/${game.id}/flags`);

    const response = await admin(`/games/${game.id}/flags/${queue[0]!.flags[0]!.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: 'DISCREDITED', metricId: 'kc.vorkath', delta: 6 }),
    });

    expect(response.status).toBe(400);
  });
});

describe('manual adjustment', () => {
  it('records an adjustment as an event so a replay still reaches the same board', async () => {
    const { game, tileIds, playerId } = await setUp();

    await json(`/games/${game.id}/adjustments`, {
      method: 'POST',
      body: JSON.stringify({
        playerId,
        metricId: 'kc.vorkath',
        delta: 12,
        reason: 'Won the pet race; nothing observes that.',
      }),
    });

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      score: 12,
    });

    const stored = await env.DB.prepare(
      "SELECT metric_type, delta, detail_json FROM events WHERE game_id = ? AND metric_type = 'MANUAL'",
    )
      .bind(game.id)
      .first<{ metric_type: string; delta: number; detail_json: string }>();

    expect(stored).toMatchObject({ metric_type: 'MANUAL', delta: 12 });
    expect(JSON.parse(stored!.detail_json)).toMatchObject({
      reason: 'Won the pet race; nothing observes that.',
    });

    // The board is unchanged by a replay, which is the whole reason it is an event.
    await json(`/games/${game.id}/replay`, { method: 'POST' });
    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toMatchObject({
      score: 12,
    });
  });

  it('refuses an adjustment with no reason and one of nothing', async () => {
    const { game, playerId } = await setUp();

    for (const body of [
      { playerId, metricId: 'kc.vorkath', delta: 5 },
      { playerId, metricId: 'kc.vorkath', delta: 0, reason: 'Nothing' },
    ]) {
      const response = await admin(`/games/${game.id}/adjustments`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  it('writes every adjustment to the audit trail', async () => {
    const { game, playerId } = await setUp();

    await json(`/games/${game.id}/adjustments`, {
      method: 'POST',
      body: JSON.stringify({
        playerId,
        metricId: 'kc.vorkath',
        delta: -3,
        reason: 'Double counted.',
      }),
    });

    const actions = await json<{ action: string; detail: Record<string, unknown> }[]>(
      `/games/${game.id}/actions`,
    );

    const discredit = actions.find((entry) => entry.action === 'DISCREDIT');
    expect(discredit?.detail).toMatchObject({ delta: -3, reason: 'Double counted.' });
  });
});

describe('evidence review', () => {
  it('browses screenshots by player and by tile', async () => {
    const { game, tileIds, client, playerId } = await setUp();

    await client.sendOne(await client.player.kill('Vorkath'));
    await client.sendOne(await client.player.kill('Vorkath'));

    const all = await json<{ event_id: string }[]>(`/games/${game.id}/screenshots`);
    expect(all).toHaveLength(2);

    const byPlayer = await json<unknown[]>(`/games/${game.id}/screenshots?playerId=${playerId}`);
    expect(byPlayer).toHaveLength(2);

    const byTile = await json<unknown[]>(`/games/${game.id}/screenshots?tileId=${tileIds[0]}`);
    expect(byTile).toHaveLength(2);

    const byTeam = await json<unknown[]>(
      `/games/${game.id}/screenshots?teamId=${game.teams[1]!.id}`,
    );
    expect(byTeam).toHaveLength(0);
  });
});
