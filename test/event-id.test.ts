// The eventId derivation is the single place where this repo must agree with the plugin byte
// for byte. If it drifts, the plugin's retries stop deduplicating and every retried kill is
// counted twice — silently, and only visible as a score that is slightly too high.

import { describe, expect, it } from 'vitest';

import { deriveEventId } from '../src/contract/event-id';
import {
  ACCOUNT_HASH,
  SESSION_ID,
  collectionLogEnvelope,
  countEnvelope,
  dropEnvelope,
  durationEnvelope,
  observedKillEnvelope,
} from './factories';

describe('deriveEventId', () => {
  // Contract section 6, verbatim:
  //   input   -4234871239847123|6b1f0c2e-3a44-4d8b-9f10-27c5e8a1b3d4|kc.vorkath|123456|342
  //   eventId 777f44d8a5a8a5a82c72a18de4c026da
  it('matches the contract worked example', async () => {
    const id = await deriveEventId(
      countEnvelope({
        accountHash: ACCOUNT_HASH,
        sessionId: SESSION_ID,
        gameTick: 123456,
        metric: { id: 'kc.vorkath', type: 'COUNT', value: 342, delta: 1, firstObservation: false },
      }),
    );

    expect(id).toBe('777f44d8a5a8a5a82c72a18de4c026da');
  });

  it('is 32 lowercase hex characters', async () => {
    const id = await deriveEventId(countEnvelope());
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  // [D10]: bare concatenation would hash `kc.a1` at tick 2 identically to `kc.a` at tick 12.
  // The pipe separator is normative precisely because of this.
  it('separates fields so adjacent values cannot collide', async () => {
    const a = await deriveEventId(
      countEnvelope({
        gameTick: 2,
        metric: { id: 'kc.a1', type: 'COUNT', value: 5, delta: 1, firstObservation: false },
      }),
    );
    const b = await deriveEventId(
      countEnvelope({
        gameTick: 12,
        metric: { id: 'kc.a', type: 'COUNT', value: 5, delta: 1, firstObservation: false },
      }),
    );

    expect(a).not.toBe(b);
  });

  // [D3]: gameTick repeats across sessions. Without sessionId, the same drop at the same tick on
  // two different days deduplicates to one event.
  it('distinguishes the same drop at the same tick in different sessions', async () => {
    const monday = await deriveEventId(dropEnvelope());
    const tuesday = await deriveEventId(
      dropEnvelope({ sessionId: '11111111-2222-3333-4444-555555555555' }),
    );

    expect(monday).not.toBe(tuesday);
  });

  it('derives a drop from itemId and quantity', async () => {
    const one = await deriveEventId(dropEnvelope());
    const two = await deriveEventId(
      dropEnvelope({
        metric: {
          id: 'drop.abyssal_whip',
          type: 'DROP',
          value: null,
          delta: 2,
          firstObservation: false,
        },
        detail: {
          itemId: 4151,
          itemName: 'Abyssal whip',
          quantity: 2,
          source: 'Abyssal demon',
          sourceType: 'NPC',
          killCount: 342,
    geValue: null,
    haValue: null,
          ruleValue: null,
          observationOrdinal: 0,
        },
      }),
    );

    expect(one).not.toBe(two);
  });

  it('distinguishes identical drops emitted on the same tick by observation ordinal', async () => {
    const first = await deriveEventId(dropEnvelope());
    const second = await deriveEventId(
      dropEnvelope({ detail: { ...dropEnvelope().detail, observationOrdinal: 1 } }),
    );

    expect(first).not.toBe(second);
  });

  it('distinguishes simultaneous kills of the same NPC by observation ordinal', async () => {
    const first = await deriveEventId(observedKillEnvelope());
    const second = await deriveEventId(
      observedKillEnvelope({
        detail: {
          npcId: 415,
          npcName: 'Abyssal demon',
          combatLevel: 124,
          signal: 'SERVER_NPC_LOOT',
          observationOrdinal: 1,
        },
      }),
    );

    expect(first).not.toBe(second);
  });

  // A collection log slot is filled once, ever. Its ID is deliberately independent of both time
  // and session, so the same slot noticed again next week is recognised as the same fact.
  it('ignores session and tick for a collection log slot', async () => {
    const first = await deriveEventId(collectionLogEnvelope());
    const later = await deriveEventId(
      collectionLogEnvelope({
        sessionId: '11111111-2222-3333-4444-555555555555',
        gameTick: 999999,
        clientTime: 1900000000000,
      }),
    );

    expect(first).toBe(later);
  });

  it('distinguishes different collection log slots', async () => {
    const pickaxe = await deriveEventId(collectionLogEnvelope());
    const whip = await deriveEventId(
      collectionLogEnvelope({
        metric: {
          id: 'collection_log.abyssal_whip',
          type: 'COLLECTION_LOG',
          value: null,
          delta: 1,
          firstObservation: false,
        },
      }),
    );

    expect(pickaxe).not.toBe(whip);
  });

  // [D5]: DURATION overloads `value` with durationMs, so it shares the COUNT derivation.
  it('derives a duration from its value', async () => {
    const fast = await deriveEventId(durationEnvelope());
    const slow = await deriveEventId(
      durationEnvelope({
        metric: {
          id: 'time.chambers_of_xeric',
          type: 'DURATION',
          value: 154801,
          delta: null,
          firstObservation: false,
        },
      }),
    );

    expect(fast).not.toBe(slow);
  });
});
