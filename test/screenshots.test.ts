// Screenshots — contract section 5.3.
//
// The image travels inside the event envelope as base64, and the plugin never uploads anywhere
// else. There is no presigned URL, no upload endpoint, and no object-store credential in the
// system: the bytes arrive with the fact they belong to.
//
// A screenshot is evidence, not data. Nothing in this path may fail an event.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import { decodeScreenshot, MAX_SCREENSHOT_BYTES } from '../src/worker/lib/screenshots';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { seedGame } from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

const withCamera = (gameId: string, accountHash: string, name: string) =>
  new SimulatedClient(
    transport,
    BASE,
    new SimulatedPlayer({
      accountHash,
      displayName: name,
      gameId,
      // What a Java runtime actually encodes, virtually always.
      screenshotMediaType: 'image/jpeg',
    }),
  );

const withoutCamera = (gameId: string, accountHash: string, name: string) =>
  new SimulatedClient(
    transport,
    BASE,
    new SimulatedPlayer({ accountHash, displayName: name, gameId }),
  );

const evidenceFor = (gameId: string, eventId: string) =>
  env.DB.prepare(
    'SELECT object_key, media_type FROM event_screenshots WHERE game_id = ? AND event_id = ?',
  )
    .bind(gameId, eventId)
    .first<{ object_key: string; media_type: string }>();

describe('decoding', () => {
  it('decodes a base64 image', () => {
    const result = decodeScreenshot('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // JPEG magic number.
      expect(result.bytes[0]).toBe(0xff);
      expect(result.bytes[1]).toBe(0xd8);
    }
  });

  it('refuses something that is not base64', () => {
    expect(decodeScreenshot('not base64 at all !!!')).toMatchObject({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it('refuses an empty payload', () => {
    expect(decodeScreenshot('')).toMatchObject({ ok: false, reason: 'MALFORMED' });
  });

  // The length is judged before decoding, so a client cannot make the Worker allocate a large
  // buffer just by claiming to have one.
  it('refuses an implausibly large image without decoding it', () => {
    const huge = 'A'.repeat(MAX_SCREENSHOT_BYTES * 2);

    expect(decodeScreenshot(huge)).toMatchObject({ ok: false, reason: 'TOO_LARGE' });
  });
});

describe('storing evidence', () => {
  it('decodes the image out of the envelope and stores it', async () => {
    const game = await seedGame(env.DB);
    const client = withCamera(game.id, '-9001', 'Snapper Sam');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');
    expect(envelope.screenshot).not.toBeNull();

    const result = await client.sendOne(envelope);
    expect(result.accepted).toBe(true);

    const key = `${game.id}/${envelope.eventId}.jpg`;
    const object = await env.SCREENSHOTS.get(key);

    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
    expect(await evidenceFor(game.id, envelope.eventId)).toMatchObject({
      object_key: key,
      media_type: 'image/jpeg',
    });
  });

  it('stores nothing when the envelope carried no image', async () => {
    const game = await seedGame(env.DB);
    const client = withoutCamera(game.id, '-9002', 'Blind Bella');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');
    expect(envelope.screenshot).toBeNull();

    await client.sendOne(envelope);

    expect(await evidenceFor(game.id, envelope.eventId)).toBeNull();
  });

  it('stores nothing when the game does not want screenshots', async () => {
    const game = await seedGame(env.DB, { screenshotsRequested: false });
    const client = withCamera(game.id, '-9003', 'Unwanted Ulf');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');
    await client.sendOne(envelope);

    expect(await evidenceFor(game.id, envelope.eventId)).toBeNull();
  });

  it('stores nothing for a rejected event', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.zulrah'] });
    const client = withCamera(game.id, '-9004', 'Rejected Rex');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');
    expect((await client.sendOne(envelope)).accepted).toBe(false);

    expect(await evidenceFor(game.id, envelope.eventId)).toBeNull();
  });

  // A retried event carries its screenshot again, so a server that lost the response — and with
  // it the image — receives it a second time.
  it('keeps a single copy when a retry re-sends the same image', async () => {
    const game = await seedGame(env.DB);
    const client = withCamera(game.id, '-9005', 'Retry Rachel');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');

    expect(await client.sendOne(envelope)).toMatchObject({ duplicate: false });
    expect(await client.sendOne(envelope)).toMatchObject({ duplicate: true });

    const { results } = await env.DB.prepare(
      'SELECT object_key FROM event_screenshots WHERE game_id = ? AND event_id = ?',
    )
      .bind(game.id, envelope.eventId)
      .all();

    expect(results).toHaveLength(1);
  });

  it('picks the evidence up from a retry when the first attempt stored none', async () => {
    const game = await seedGame(env.DB, { screenshotsRequested: false });
    const client = withCamera(game.id, '-9006', 'Second Chance Sue');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');
    await client.sendOne(envelope);
    expect(await evidenceFor(game.id, envelope.eventId)).toBeNull();

    // The organiser turns screenshots on partway through.
    await env.DB.prepare('UPDATE games SET screenshots_requested = 1 WHERE id = ?')
      .bind(game.id)
      .run();

    await client.sendOne(envelope);

    expect(await evidenceFor(game.id, envelope.eventId)).not.toBeNull();
  });
});

describe('a bad image never costs an event', () => {
  const sendWithImage = async (accountHash: string, name: string, screenshot: string) => {
    const game = await seedGame(env.DB);
    const client = withCamera(game.id, accountHash, name);
    await client.sync(game.joinCode);

    const base = await client.player.kill('Vorkath');
    // The eventId derivation does not cover the screenshot, so the ID stays correct.
    const envelope = { ...base, screenshot };
    const result = await client.sendOne(envelope);

    return { game, envelope, result };
  };

  it('records the event when the image will not decode', async () => {
    const { game, envelope, result } = await sendWithImage(
      '-9101',
      'Garbled Gary',
      'this is not base64 !!!',
    );

    expect(result.accepted).toBe(true);
    expect(await evidenceFor(game.id, envelope.eventId)).toBeNull();

    const stored = await env.DB.prepare(
      'SELECT metric_id FROM events WHERE game_id = ? AND event_id = ?',
    )
      .bind(game.id, envelope.eventId)
      .first<{ metric_id: string }>();
    expect(stored?.metric_id).toBe('kc.vorkath');
  });

  it('records and credits the event when the image is too large', async () => {
    const { game, envelope, result } = await sendWithImage(
      '-9102',
      'Huge Hugo',
      // Four base64 characters carry three bytes, so this decodes to more than the ceiling
      // while the request as a whole stays under the 2 MB batch limit.
      'A'.repeat(MAX_SCREENSHOT_BYTES * 1.5),
    );

    expect(result.accepted).toBe(true);
    expect(await evidenceFor(game.id, envelope.eventId)).toBeNull();

    const credit = await env.DB.prepare(
      'SELECT credited FROM event_credit WHERE game_id = ? AND event_id = ?',
    )
      .bind(game.id, envelope.eventId)
      .first<{ credited: number }>();
    expect(credit?.credited).toBe(1);
  });
});

describe('the batch size ceiling', () => {
  // Screenshots travel inside the envelope, so a batch counted only by event number could reach
  // tens of megabytes. The plugin caps itself at 2 MB; the server does not take its word for it.
  it('refuses a request above 2 MB', async () => {
    const game = await seedGame(env.DB);
    const client = withCamera(game.id, '-9201', 'Floody Fred');
    await client.sync(game.joinCode);

    const base = await client.player.kill('Vorkath');
    const bloated = { ...base, screenshot: 'A'.repeat(3 * 1024 * 1024) };

    const response = await client.sendRaw([bloated]);

    expect(response.status).toBe(400);
  });

  it('accepts a batch of ordinary envelopes carrying images', async () => {
    const game = await seedGame(env.DB);
    const client = withCamera(game.id, '-9202', 'Busy Bee');
    await client.sync(game.joinCode);

    const envelopes = [
      await client.player.kill('Vorkath'),
      await client.player.kill('Vorkath'),
      await client.player.drop(4151, 'Abyssal whip', 'Abyssal demon'),
    ];

    const results = await client.send(envelopes);

    expect(results.size).toBe(3);
    for (const envelope of envelopes) {
      expect(await evidenceFor(game.id, envelope.eventId)).not.toBeNull();
    }
  });
});

describe('the old upload endpoint', () => {
  // Draft 6 removed it. It should not exist, and nothing should answer on it.
  it('is gone', async () => {
    const response = await transport.fetch(
      new Request(`${BASE}/api/plugin/screenshot/anything`, {
        method: 'PUT',
        body: new Uint8Array([1, 2, 3]),
      }),
    );

    expect(response.status).toBe(404);
  });
});
