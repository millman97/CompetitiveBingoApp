// Deriving what one observation is worth — spec sections 5.4, 5.5 and 6.1.
//
// Pure: no database, no clock, no bindings. Everything it needs is an argument and everything it
// decides is in the return value, including the flags it thinks a human should look at. The
// caller decides whether to persist those — ingestion does, replay does not, because a replay is
// recomputing scores rather than re-observing facts, and an admin's flag resolutions must survive
// it untouched.

import type { BackfillPolicy } from '../db/games';
import type { FlagKind } from '../db/flags';
import type { Observation } from './observation';

/** Last absolute value seen for a (game, player, metric), or null if none has been. */
export interface MetricState {
  lastValue: number | null;
  lastSeenAt: number;
}

export interface Thresholds {
  /** COUNT: credited increments per minute above which the rate is implausible. */
  maxPerMinute: number;
  /** DURATION: a run faster than this is implausible. */
  minDurationMs: number;
}

/**
 * Shipped defaults, deliberately generous. A flag that fires on ordinary play trains an organiser
 * to ignore the flag queue, which costs more than the cheating it was meant to catch.
 *
 * 120 observations a minute leaves room for fast multi-target monster tasks while still catching
 * fabricated bursts. Boss metrics may use a lower per-metric override. Ten seconds is shorter
 * than any activity that announces a duration.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  maxPerMinute: 120,
  minDurationMs: 10_000,
};

/**
 * Delta-only observed kills use metric_state as a one-minute tumbling rate bucket. `lastValue`
 * is the number of observations in the current bucket and `lastSeenAt` is its start. This state
 * is derived and replayable; it is not a client-supplied cumulative kill count.
 */
const deriveKill = (input: DeriveInput): Derivation => {
  const { observation, state, thresholds } = input;
  const receivedAt = observation.receivedAt;
  const windowExpired = state !== null && receivedAt - state.lastSeenAt >= 60_000;
  const windowStart = state === null || windowExpired ? receivedAt : state.lastSeenAt;
  const observedInWindow = state === null || windowExpired ? 1 : (state.lastValue ?? 0) + 1;
  const flags: DerivedFlag[] = [];

  if (observedInWindow > thresholds.maxPerMinute) {
    flags.push({
      kind: 'IMPLAUSIBLE_RATE',
      detail: {
        metricId: observation.metricId,
        observedInWindow,
        elapsedMs: receivedAt - windowStart,
        perMinute: observedInWindow,
        ceiling: thresholds.maxPerMinute,
        signal: 'SERVER_NPC_LOOT',
      },
    });
  }

  return {
    credited: 1,
    derivedDelta: null,
    nextState: { lastValue: observedInWindow, lastSeenAt: windowStart },
    flags,
  };
};

export interface DerivedFlag {
  kind: FlagKind;
  detail: Record<string, unknown>;
}

export interface Derivation {
  /** What this observation adds to a team's total, after the backfill policy. */
  credited: number;
  /** The full increment the absolute value implied, before the policy trimmed it. */
  derivedDelta: number | null;
  /** The metric state to store, or null for a metric that keeps none. */
  nextState: MetricState | null;
  flags: DerivedFlag[];
}

export interface DeriveInput {
  observation: Observation;
  /** Null when this is the first time the server has seen this metric for this player. */
  state: MetricState | null;
  backfillPolicy: BackfillPolicy;
  thresholds: Thresholds;
}

/**
 * The rate check, applied to credited COUNT increments only.
 *
 * The window is floored at a minute so that a batch of events arriving milliseconds apart — which
 * is simply how the plugin sends — does not read as an infinite rate.
 */
const rateFlag = (
  metricId: string,
  credited: number,
  state: MetricState,
  receivedAt: number,
  maxPerMinute: number,
): DerivedFlag | null => {
  const elapsed = Math.max(receivedAt - state.lastSeenAt, 60_000);
  const perMinute = credited / (elapsed / 60_000);

  if (perMinute <= maxPerMinute) {
    return null;
  }

  return {
    kind: 'IMPLAUSIBLE_RATE',
    detail: {
      metricId,
      credited,
      elapsedMs: receivedAt - state.lastSeenAt,
      perMinute: Math.round(perMinute * 100) / 100,
      ceiling: maxPerMinute,
    },
  };
};

const deriveCount = (input: DeriveInput): Derivation => {
  const { observation, state, backfillPolicy, thresholds } = input;
  const { metricId, receivedAt } = observation;

  // A COUNT always carries an absolute value; the schema pins it to an integer.
  const value = observation.value as number;
  // A count message announces exactly one kill, whether or not the plugin held a baseline.
  const envelopeDelta = observation.delta ?? 1;
  const stored = state?.lastValue ?? null;

  const flags: DerivedFlag[] = [];

  // First observation server-side: there is nothing to difference against, so credit the one
  // kill this message announces and take the value as the baseline.
  if (stored === null) {
    const credited = envelopeDelta;
    if (state !== null) {
      const rate = rateFlag(metricId, credited, state, receivedAt, thresholds.maxPerMinute);
      if (rate !== null) {
        flags.push(rate);
      }
    }
    return {
      credited,
      derivedDelta: credited,
      nextState: { lastValue: value, lastSeenAt: receivedAt },
      flags,
    };
  }

  const derivedDelta = value - stored;

  // A cumulative counter cannot go backwards. Credit nothing, and deliberately do not lower the
  // stored baseline: doing so would make the next legitimate kill credit the whole difference
  // again, turning one bad value into a large amount of invented progress.
  if (derivedDelta < 0) {
    return {
      credited: 0,
      derivedDelta,
      nextState: { lastValue: stored, lastSeenAt: receivedAt },
      flags: [
        {
          kind: 'MONOTONIC_DECREASE',
          detail: { metricId, reported: value, stored, firstObservation: observation.firstObservation },
        },
      ],
    };
  }

  // A gap means kills happened where this plugin was not watching: mobile, another client, or the
  // plugin switched off. Which is fine in a week-long classic event and an exploit in a live one.
  const isBackfill = derivedDelta > envelopeDelta;
  let credited = derivedDelta;

  if (isBackfill) {
    if (backfillPolicy === 'IGNORE') {
      credited = envelopeDelta;
    } else if (backfillPolicy === 'FLAG_ONLY') {
      flags.push({
        kind: 'BACKFILL',
        detail: {
          metricId,
          derivedDelta,
          reportedDelta: envelopeDelta,
          unexplained: derivedDelta - envelopeDelta,
          // The plugin holding no baseline means the gap is unexplained rather than a dropped
          // event. Recorded as context, not as guilt.
          firstObservation: observation.firstObservation,
        },
      });
    }
  }

  if (state !== null) {
    const rate = rateFlag(metricId, credited, state, receivedAt, thresholds.maxPerMinute);
    if (rate !== null) {
      flags.push(rate);
    }
  }

  return {
    credited,
    derivedDelta,
    nextState: { lastValue: value, lastSeenAt: receivedAt },
    flags,
  };
};

/**
 * Works out what an observation contributes.
 *
 * The five wire types behave differently on purpose:
 *
 * - COUNT carries an absolute, so the server differences it against its own history. That is what
 *   makes a retry harmless, lets a missed event self-heal on the next kill, and exposes
 *   off-plugin play.
 * - DROP has no absolute at all. A drop lost in transit is lost permanently and the server cannot
 *   detect it. Missing drops need a manual submission or an admin adjustment.
 * - COLLECTION_LOG has a value that is usually null, so it cannot be differenced either. Its
 *   event ID deliberately omits session and tick, so a slot is idempotent forever and plain
 *   deduplication is the whole protection.
 * - KILL is also delta-only. It credits one server-attributed observation, keeps a short rate
 *   bucket, and relies on its deterministic ID for retry safety.
 * - DURATION is not cumulative and lower is better, so it credits nothing: a MIN_DURATION tile
 *   reads the value itself rather than a running total.
 */
export const derive = (input: DeriveInput): Derivation => {
  const { observation, thresholds } = input;

  /*
   * A hand-typed event credits what the plugin read out of the string and nothing more.
   *
   * It deliberately does not touch the stored baseline: the value is a figure somebody typed, and
   * letting it set the baseline would make one typo silently rewrite what every later real kill
   * is measured against. It also skips the plausibility checks, which measure derived increments
   * against history this event is not part of — the review it gets is a human one, and every
   * manual entry gets that regardless.
   */
  if (observation.source === 'MANUAL') {
    return {
      credited: observation.delta ?? 0,
      derivedDelta: null,
      nextState: null,
      flags: [],
    };
  }

  switch (observation.type) {
    case 'COUNT':
      return deriveCount(input);

    case 'KILL':
      return deriveKill(input);

    case 'DROP':
    case 'COLLECTION_LOG':
      // No absolute to self-heal against; deduplication on (gameId, eventId) is the protection.
      return {
        credited: observation.delta ?? 1,
        derivedDelta: null,
        nextState: null,
        flags: [],
      };

    case 'DURATION': {
      const durationMs = observation.value as number;
      const flags: DerivedFlag[] =
        durationMs < thresholds.minDurationMs
          ? [
              {
                kind: 'IMPLAUSIBLE_DURATION',
                detail: {
                  metricId: observation.metricId,
                  durationMs,
                  floorMs: thresholds.minDurationMs,
                },
              },
            ]
          : [];

      return { credited: 0, derivedDelta: null, nextState: null, flags };
    }

    case 'MANUAL':
      // An admin adjustment credits exactly what it says, and may be negative to take progress
      // away. It carries no absolute and keeps no state.
      return {
        credited: observation.delta ?? 0,
        derivedDelta: null,
        nextState: null,
        flags: [],
      };
  }
};
