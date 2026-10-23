// Hand-typed events, value-range drop metrics, and the plugin's board pop-out.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import type { PluginBoard } from '../src/worker/do/plugin-board';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { assignTeam, seedGame, seedTiles, tileProgress } from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

const setUp = async (options: { manualEntryAllowed?: boolean; tiles?: boolean } = {}) => {
  const game = await seedGame(env.DB, {
    trackedMetrics: ['kc.vorkath', 'time.chambers_of_xeric', 'drop.*'],
  });

  if (options.tiles !== false) {
    await seedTiles(env.DB, game.id, [
      { row: 0, col: 0, label: 'Vorkath x5', metrics: ['kc.vorkath'], aggregate: 'SUM', target: 5 },
      {
        row: 0,
        col: 1,
        label: 'Fastest CoX',
        metrics: ['time.chambers_of_xeric'],
        aggregate: 'MIN_DURATION',
        target: null,
      },
    ]);
  }

  if (options.manualEntryAllowed === false) {
    await env.DB.prepare('UPDATE games SET manual_entry_allowed = 0 WHERE id = ?')
      .bind(game.id)
      .run();
  }

  const hash = `-80${Date.now() % 100000}`;
  const client = new SimulatedClient(
    transport,
    BASE,
    new SimulatedPlayer({
      accountHash: hash,
      displayName: 'Safespot Ted',
      gameId: game.id,
      screenshotMediaType: 'image/jpeg',
    }),
  );
  await client.sync(game.joinCode);
  await assignTeam(env.DB, game.id, hash, game.teams[0]!.id);

  return { game, client, hash };
};

const flagsOf = async (gameId: string, kind: string) => {
  const { results } = await env.DB.prepare(
    'SELECT detail_json FROM flags WHERE game_id = ? AND kind = ?',
  )
    .bind(gameId, kind)
    .all<{ detail_json: string }>();
  return results.map((row) => JSON.parse(row.detail_json) as Record<string, unknown>);
};

describe('hand-typed events', () => {
  it('accepts one and credits what the plugin read out of it', async () => {
    const { game, client } = await setUp();

    const envelope = await client.player.manual('kc.vorkath', 'Vorkath kills', '3', {
      value: 3,
      delta: 1,
      interpretedAs: 'count',
    });

    expect(await client.sendOne(envelope)).toMatchObject({ accepted: true, duplicate: false });

    const stored = await env.DB.prepare(
      'SELECT source, metric_type, detail_json FROM events WHERE game_id = ? AND event_id = ?',
    )
      .bind(game.id, envelope.eventId)
      .first<{ source: string; metric_type: string; detail_json: string }>();

    expect(stored).toMatchObject({ source: 'MANUAL', metric_type: 'COUNT' });
    expect(JSON.parse(stored!.detail_json)).toMatchObject({ input: '3', interpretedAs: 'count' });
  });

  // The plugin vouches for the screenshot and for nothing else, so every one gets a human look.
  it('flags every one for review, with what was typed', async () => {
    const { game, client } = await setUp();

    await client.sendOne(
      await client.player.manual('time.chambers_of_xeric', 'CoX time', '25:00', {
        value: 1_500_000,
        interpretedAs: 'duration',
      }),
    );

    const flags = await flagsOf(game.id, 'MANUAL_ENTRY');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      metricId: 'time.chambers_of_xeric',
      typed: '25:00',
      interpretedAs: 'duration',
      hasScreenshot: true,
    });
  });

  // Refusing an input nothing could be read out of would take away the only route for exactly the
  // cases manual entry exists to cover.
  it('accepts one whose value could not be read at all', async () => {
    const { game, client } = await setUp();

    const envelope = await client.player.manual('kc.vorkath', 'Vorkath kills', 'about a dozen', {
      value: null,
      delta: 1,
      interpretedAs: null,
    });

    expect(await client.sendOne(envelope)).toMatchObject({ accepted: true });

    const flags = await flagsOf(game.id, 'MANUAL_ENTRY');
    expect(flags[0]).toMatchObject({ typed: 'about a dozen', interpretedAs: null });
  });

  // The value is a figure somebody typed. Letting it set the baseline would make one typo rewrite
  // what every later real kill is measured against.
  it('never lets a typed value become the baseline for observed events', async () => {
    const { game, client } = await setUp();

    await client.sendOne(await client.player.kill('Vorkath'));
    await client.sendOne(
      await client.player.manual('kc.vorkath', 'Vorkath kills', '900', {
        value: 900,
        delta: 1,
        interpretedAs: 'count',
      }),
    );

    const state = await env.DB.prepare(
      'SELECT last_value FROM metric_state WHERE game_id = ? AND metric_id = ?',
    )
      .bind(game.id, 'kc.vorkath')
      .first<{ last_value: number }>();

    // Still the observed count, not the typed one.
    expect(state?.last_value).toBe(1);

    // One observed kill plus one credited by hand.
    const tile = await env.DB.prepare("SELECT id FROM tiles WHERE game_id = ? AND label = 'Vorkath x5'")
      .bind(game.id)
      .first<{ id: string }>();
    expect(await tileProgress(env.DB, game.id, tile!.id, game.teams[0]!.id)).toMatchObject({
      score: 2,
    });
  });

  it('refuses one on a game that does not allow them', async () => {
    const { client } = await setUp({ manualEntryAllowed: false });

    const result = await client.sendOne(
      await client.player.manual('kc.vorkath', 'Vorkath kills', '3', { value: 3, delta: 1 }),
    );

    expect(result).toMatchObject({ accepted: false, rejectionReason: 'INVALID' });
  });

  it('dedupes a resend of the same typed entry', async () => {
    const { client } = await setUp();

    const envelope = await client.player.manual('kc.vorkath', 'Vorkath kills', '3', {
      value: 3,
      delta: 1,
    });

    expect(await client.sendOne(envelope)).toMatchObject({ duplicate: false });
    expect(await client.sendOne(envelope)).toMatchObject({ accepted: true, duplicate: true });
  });

  it('tells the plugin whether the control should be offered', async () => {
    const allowed = await setUp();
    const refused = await setUp({ manualEntryAllowed: false });

    const read = async (joinCode: string) =>
      (await (await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${joinCode}`))).json()) as {
        manualEntryAllowed: boolean;
      };

    expect((await read(allowed.game.joinCode)).manualEntryAllowed).toBe(true);
    expect((await read(refused.game.joinCode)).manualEntryAllowed).toBe(false);
  });
});

describe('value-range drop metrics', () => {
  const addRule = (gameId: string) =>
    env.DB.prepare(
      `INSERT INTO drop_value_rules (game_id, metric_id, label, min_value, max_value, valuation, counts)
       VALUES (?, 'drop.worth_1m_plus', 'Drops worth 1m or more', 1000000, NULL, 'GRAND_EXCHANGE', 'ITEMS')`,
    )
      .bind(gameId)
      .run();

  it('sends the rules to the plugin, with their labels', async () => {
    const { game } = await setUp();
    await addRule(game.id);

    const config = (await (
      await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`))
    ).json()) as {
      dropValueRules: { metricId: string; minValue: number; counts: string }[];
      metricLabels: Record<string, string>;
    };

    expect(config.dropValueRules).toEqual([
      {
        metricId: 'drop.worth_1m_plus',
        label: 'Drops worth 1m or more',
        minValue: 1000000,
        maxValue: null,
        valuation: 'GRAND_EXCHANGE',
        counts: 'ITEMS',
      },
    ]);
    // A label naming a rule is used even though the rule is not in trackedMetrics.
    expect(config.metricLabels['drop.worth_1m_plus']).toBe('Drops worth 1m or more');
  });

  // Naming a rule is what asks for the metric, so rejecting it would refuse an event the server
  // itself asked for.
  it('accepts a rule metric without it being listed as tracked', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    await addRule(game.id);
    await seedTiles(env.DB, game.id, [
      {
        row: 0,
        col: 0,
        label: 'Big drops',
        metrics: ['drop.worth_1m_plus'],
        aggregate: 'SUM',
        target: 1,
      },
    ]);

    const hash = '-80999';
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: hash, displayName: 'Lucky Luke', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, hash, game.teams[0]!.id);

    const envelope = await client.player.drop(11832, 'Bandos chestplate', 'General Graardor', 1, {
      metricId: 'drop.worth_1m_plus',
      geValue: 12_000_000,
      ruleValue: 12_000_000,
    });

    expect(await client.sendOne(envelope)).toMatchObject({ accepted: true });

    const stored = await env.DB.prepare(
      'SELECT detail_json FROM events WHERE game_id = ? AND event_id = ?',
    )
      .bind(game.id, envelope.eventId)
      .first<{ detail_json: string }>();

    // The figure the rule was tested against travels with the event, so a dispute can see why it
    // fired without trusting the client's price.
    expect(JSON.parse(stored!.detail_json)).toMatchObject({
      geValue: 12_000_000,
      ruleValue: 12_000_000,
    });
  });
});

describe('the plugin board', () => {
  const fetchBoard = async (client: SimulatedClient) =>
    app.fetch(
      new Request(`${BASE}/api/plugin/board`, {
        headers: { Authorization: `Bearer ${client.playerToken}` },
      }),
      testEnv,
    );

  it('draws the board with the viewer’s own team first', async () => {
    const { client } = await setUp();

    await client.sendOne(await client.player.kill('Vorkath'));
    await client.sendOne(await client.player.kill('Vorkath'));

    const response = await fetchBoard(client);
    expect(response.status).toBe(200);

    const board = (await response.json()) as PluginBoard;

    expect(board.title).toBeTruthy();
    const grid = board.sections.find((section) => section.kind === 'GRID');
    expect(grid?.cells).toHaveLength(2);

    const vorkath = grid?.cells?.find((cell) => cell.title === 'Vorkath x5');
    expect(vorkath?.lines?.[0]).toBe('2 / 5');
    expect(vorkath?.state).toBe('IN_PROGRESS');

    // And a standings list, with the viewer's team marked.
    const list = board.sections.find((section) => section.kind === 'LIST');
    expect(list?.cells?.some((cell) => cell.tooltip === 'Your team')).toBe(true);
  });

  it('404s when the game has no board, rather than failing the sync', async () => {
    const { client } = await setUp({ tiles: false });

    expect((await fetchBoard(client)).status).toBe(404);
  });

  it('needs a token', async () => {
    const response = await app.fetch(new Request(`${BASE}/api/plugin/board`), testEnv);
    expect(response.status).toBe(401);
  });
});
