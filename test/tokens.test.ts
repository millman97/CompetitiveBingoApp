import { describe, expect, it } from 'vitest';

import { signToken, verifyToken, type PlayerTokenData } from '../src/worker/lib/tokens';

const KEY = 'a-test-signing-key';
const HOUR = 60 * 60 * 1000;

describe('signed tokens', () => {
  it('round-trips a payload', async () => {
    const data: PlayerTokenData = { gameId: 'g_7f3a91', accountHash: '-4234871239847123' };
    const token = await signToken(KEY, 'player', data, Date.now() + HOUR);

    expect(await verifyToken<PlayerTokenData>(KEY, 'player', token)).toEqual(data);
  });

  // accountHash exceeds 2^53. If it ever round-trips through a JS number it comes back subtly
  // wrong, and the player silently becomes a different player.
  it('preserves a large accountHash exactly', async () => {
    const accountHash = '1818775870234376620';
    const token = await signToken(KEY, 'player', { gameId: 'g_1', accountHash }, Date.now() + HOUR);
    const back = await verifyToken<PlayerTokenData>(KEY, 'player', token);

    expect(back?.accountHash).toBe(accountHash);
  });

  it('rejects a token signed with a different key', async () => {
    const token = await signToken(KEY, 'player', { gameId: 'g_1' }, Date.now() + HOUR);

    expect(await verifyToken( 'another-key', 'player', token)).toBeNull();
  });

  // Without the purpose field a player token would verify as an admin session.
  it('rejects a token issued for a different purpose', async () => {
    const token = await signToken(KEY, 'player', { gameId: 'g_1' }, Date.now() + HOUR);

    expect(await verifyToken(KEY, 'admin', token)).toBeNull();
    expect(await verifyToken(KEY, 'player', token)).not.toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signToken(KEY, 'player', { gameId: 'g_1' }, Date.now() - 1);

    expect(await verifyToken(KEY, 'player', token)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signToken(KEY, 'player', { gameId: 'g_1' }, Date.now() + HOUR);
    const [body, signature] = token.split('.') as [string, string];
    const forged = `${btoa('{"p":"player","e":9999999999999,"d":{"gameId":"g_2"}}')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}.${signature}`;

    expect(forged).not.toBe(`${body}.${signature}`);
    expect(await verifyToken(KEY, 'player', forged)).toBeNull();
  });

  it('rejects structurally broken tokens', async () => {
    for (const bad of ['', '.', 'nodot', 'a.', '.b', 'not-base64!.also-not']) {
      expect(await verifyToken(KEY, 'player', bad)).toBeNull();
    }
  });
});
