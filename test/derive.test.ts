// Delta derivation, backfill policy and the checks that come out of them.
//
// These are pure: no database, no clock. The derivation is the single most consequential piece of
// arithmetic in the server, so it is tested on its own before anything is wired to it.

import { describe, expect, it } from 'vitest';

import { DEFAULT_THRESHOLDS, derive, type DeriveInput } from '../src/worker/scoring/derive';
import type { Observation } from '../src/worker/scoring/observation';

const AT = 1_700_000_000_000;
const MINUTE = 60_000;

const count = (value: number, over: Partial<Observation> = {}): Observation => ({
  metricId: 'kc.vorkath',
  type: 'COUNT',
  source: 'OBSERVED',
  value,
  delta: 1,
  firstObservation: false,
  receivedAt: AT,
  ...over,
});

const run = (over: Partial<DeriveInput>): ReturnType<typeof derive> =>
  derive({
    observation: count(1),
    state: null,
    backfillPolicy: 'COUNT',
    thresholds: DEFAULT_THRESHOLDS,
    ...over,
  });

const kinds = (result: ReturnType<typeof derive>): string[] =>
  result.flags.map((flag) => flag.kind);

describe('COUNT derivation', () => {
  // A count message announces exactly one kill; the server holding no baseline does not change
  // what happened.
  it('credits one on the first observation and takes the value as the baseline', () => {
    const result = run({ observation: count(342, { firstObservation: true }), state: null });

    expect(result.credited).toBe(1);
    expect(result.nextState).toEqual({ lastValue: 342, lastSeenAt: AT });
    expect(result.flags).toEqual([]);
  });

  it('credits the difference against the stored value', () => {
    const result = run({
      observation: count(336),
      state: { lastValue: 335, lastSeenAt: AT - MINUTE },
    });

    expect(result.credited).toBe(1);
    expect(result.derivedDelta).toBe(1);
    expect(result.nextState?.lastValue).toBe(336);
  });

  // The whole point of sending an absolute: a dropped event self-heals on the next kill rather
  // than being lost.
  it('self-heals a missed event on the next observation', () => {
    const result = run({
      observation: count(337),
      state: { lastValue: 335, lastSeenAt: AT - MINUTE },
    });

    expect(result.credited).toBe(2);
  });
});

describe('backfill policy', () => {
  // Stored 335, reporting 342 with delta 1: six kills happened where the plugin was not watching.
  const backfilled = { observation: count(342), state: { lastValue: 335, lastSeenAt: AT - MINUTE } };

  it('COUNT credits the whole derived delta', () => {
    const result = run({ ...backfilled, backfillPolicy: 'COUNT' });

    expect(result.credited).toBe(7);
    expect(result.derivedDelta).toBe(7);
    expect(kinds(result)).toEqual([]);
  });

  // The exploit this exists to close: play on mobile with the plugin off, then log in on PC in
  // the final minute and dump the lot.
  it('IGNORE credits only the reported delta but records the rest', () => {
    const result = run({ ...backfilled, backfillPolicy: 'IGNORE' });

    expect(result.credited).toBe(1);
    expect(result.derivedDelta).toBe(7);
  });

  it('FLAG_ONLY credits in full and raises a flag', () => {
    const result = run({ ...backfilled, backfillPolicy: 'FLAG_ONLY' });

    expect(result.credited).toBe(7);
    expect(kinds(result)).toEqual(['BACKFILL']);
    expect(result.flags[0]?.detail).toMatchObject({ derivedDelta: 7, reportedDelta: 1, unexplained: 6 });
  });

  it('does not treat an ordinary kill as backfill under any policy', () => {
    for (const policy of ['COUNT', 'IGNORE', 'FLAG_ONLY'] as const) {
      const result = run({
        observation: count(336),
        state: { lastValue: 335, lastSeenAt: AT - MINUTE },
        backfillPolicy: policy,
      });

      expect(result.credited).toBe(1);
      expect(kinds(result)).toEqual([]);
    }
  });

  // firstObservation means the plugin holds no baseline, so the gap is unexplained rather than a
  // dropped event. Recorded as context, never treated as guilt.
  it('records whether the plugin held a baseline', () => {
    const result = run({
      observation: count(342, { firstObservation: true }),
      state: { lastValue: 335, lastSeenAt: AT - MINUTE },
      backfillPolicy: 'FLAG_ONLY',
    });

    expect(result.flags[0]?.detail).toMatchObject({ firstObservation: true });
    expect(result.credited).toBe(7);
  });
});

describe('monotonic decrease', () => {
  it('credits nothing and flags a count that went backwards', () => {
    const result = run({
      observation: count(300),
      state: { lastValue: 335, lastSeenAt: AT - MINUTE },
    });

    expect(result.credited).toBe(0);
    expect(kinds(result)).toEqual(['MONOTONIC_DECREASE']);
  });

  // Lowering the baseline would make the next legitimate kill credit the whole difference again,
  // turning one bad value into a large amount of invented progress.
  it('keeps the higher baseline so the next kill cannot re-credit the gap', () => {
    const result = run({
      observation: count(300),
      state: { lastValue: 335, lastSeenAt: AT - MINUTE },
    });

    expect(result.nextState?.lastValue).toBe(335);

    const next = run({
      observation: count(336),
      state: result.nextState,
    });

    expect(next.credited).toBe(1);
  });
});

describe('rate plausibility', () => {
  it('accepts an ordinary run of kills', () => {
    const result = run({
      observation: count(340),
      state: { lastValue: 335, lastSeenAt: AT - 10 * MINUTE },
    });

    expect(kinds(result)).toEqual([]);
  });

  it('flags an implausible burst without refusing it', () => {
    const result = run({
      observation: count(1335),
      state: { lastValue: 335, lastSeenAt: AT - MINUTE },
      backfillPolicy: 'COUNT',
    });

    // A thousand kills in a minute. Flagged, and still credited — a flag never alters a score.
    expect(result.credited).toBe(1000);
    expect(kinds(result)).toContain('IMPLAUSIBLE_RATE');
  });

  // The plugin batches, so several envelopes routinely arrive milliseconds apart. Measuring a
  // rate over that window would flag ordinary play.
  it('does not flag a batch arriving in the same instant', () => {
    const result = run({
      observation: count(336),
      state: { lastValue: 335, lastSeenAt: AT },
    });

    expect(kinds(result)).toEqual([]);
  });

  it('honours a per-metric ceiling', () => {
    const result = run({
      observation: count(340),
      state: { lastValue: 335, lastSeenAt: AT - MINUTE },
      thresholds: { ...DEFAULT_THRESHOLDS, maxPerMinute: 2 },
    });

    expect(kinds(result)).toContain('IMPLAUSIBLE_RATE');
  });
});

describe('the other metric types', () => {
  it('credits each server-observed kill once and keeps a rate bucket, not a cumulative baseline', () => {
    const result = run({
      observation: {
        metricId: 'kill.abyssal_demon',
        type: 'KILL',
        source: 'OBSERVED',
        value: null,
        delta: 1,
        firstObservation: true,
        receivedAt: AT,
      },
    });

    expect(result.credited).toBe(1);
    expect(result.derivedDelta).toBeNull();
    expect(result.nextState).toEqual({ lastValue: 1, lastSeenAt: AT });
  });

  it('flags an implausible observed-kill burst without withholding the kill', () => {
    const result = run({
      observation: {
        metricId: 'kill.abyssal_demon',
        type: 'KILL',
        source: 'OBSERVED',
        value: null,
        delta: 1,
        firstObservation: false,
        receivedAt: AT,
      },
      state: { lastValue: 120, lastSeenAt: AT - 10_000 },
    });

    expect(result.credited).toBe(1);
    expect(kinds(result)).toEqual(['IMPLAUSIBLE_RATE']);
    expect(result.flags[0]?.detail).toMatchObject({ observedInWindow: 121, ceiling: 120 });
  });

  it('starts a fresh observed-kill rate bucket after one minute', () => {
    const result = run({
      observation: {
        metricId: 'kill.abyssal_demon',
        type: 'KILL',
        source: 'OBSERVED',
        value: null,
        delta: 1,
        firstObservation: false,
        receivedAt: AT,
      },
      state: { lastValue: 120, lastSeenAt: AT - MINUTE },
    });

    expect(result.flags).toEqual([]);
    expect(result.nextState).toEqual({ lastValue: 1, lastSeenAt: AT });
  });

  // A drop is not a counter. There is no absolute to self-heal against, so deduplication on
  // (gameId, eventId) is the only protection there is.
  it('credits a drop by its quantity and keeps no state', () => {
    const result = run({
      observation: {
        metricId: 'drop.abyssal_whip',
        type: 'DROP',
        source: 'OBSERVED',
        value: null,
        delta: 2,
        firstObservation: false,
        receivedAt: AT,
      },
    });

    expect(result.credited).toBe(2);
    expect(result.nextState).toBeNull();
    expect(result.derivedDelta).toBeNull();
  });

  // Its value is usually null, so it cannot be differenced. Its event ID omits session and tick,
  // so the same slot is the same fact forever.
  it('credits a collection log slot once and keeps no state', () => {
    const result = run({
      observation: {
        metricId: 'collection_log.dragon_pickaxe',
        type: 'COLLECTION_LOG',
        source: 'OBSERVED',
        value: null,
        delta: 1,
        firstObservation: false,
        receivedAt: AT,
      },
    });

    expect(result.credited).toBe(1);
    expect(result.nextState).toBeNull();
  });

  // Durations are not cumulative and lower is better, so they credit nothing: a MIN_DURATION tile
  // reads the value itself.
  it('credits nothing for a duration', () => {
    const result = run({
      observation: {
        metricId: 'time.chambers_of_xeric',
        type: 'DURATION',
        source: 'OBSERVED',
        value: 154_800,
        delta: null,
        firstObservation: false,
        receivedAt: AT,
      },
    });

    expect(result.credited).toBe(0);
    expect(result.nextState).toBeNull();
    expect(kinds(result)).toEqual([]);
  });

  it('flags a duration below the floor', () => {
    const result = run({
      observation: {
        metricId: 'time.chambers_of_xeric',
        type: 'DURATION',
        source: 'OBSERVED',
        value: 1_200,
        delta: null,
        firstObservation: false,
        receivedAt: AT,
      },
    });

    expect(kinds(result)).toEqual(['IMPLAUSIBLE_DURATION']);
  });

  it('credits an admin adjustment exactly, including a negative one', () => {
    const adjust = (delta: number) =>
      run({
        observation: {
          metricId: 'kc.vorkath',
          type: 'MANUAL',
          source: 'OBSERVED',
          value: null,
          delta,
          firstObservation: false,
          receivedAt: AT,
        },
      });

    expect(adjust(5).credited).toBe(5);
    expect(adjust(-3).credited).toBe(-3);
    expect(adjust(5).nextState).toBeNull();
  });
});
