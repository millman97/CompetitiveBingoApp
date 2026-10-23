// Event shapes, tested without a Worker, database, network or game client.

import { describe, expect, it } from 'vitest';

import { validateEnvelope } from '../src/contract/validate';
import { dropEnvelope, observedKillEnvelope } from './factories';

describe('observed kills', () => {
  it('accepts the delta-only server NPC-loot shape', () => {
    const result = validateEnvelope(observedKillEnvelope());
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('requires a per-tick observation ordinal', () => {
    const envelope = observedKillEnvelope() as unknown as Record<string, unknown>;
    const detail = { ...(envelope['detail'] as Record<string, unknown>) };
    delete detail['observationOrdinal'];
    envelope['detail'] = detail;

    expect(validateEnvelope(envelope).ok).toBe(false);
  });

  it('rejects cumulative values and multi-kill deltas', () => {
    expect(
      validateEnvelope(
        observedKillEnvelope({
          metric: {
            id: 'kill.abyssal_demon',
            type: 'KILL',
            value: 12,
            delta: 2,
            firstObservation: false,
          },
        } as never),
      ).ok,
    ).toBe(false);
  });
});

describe('drops', () => {
  it('requires the collision-safe observation ordinal', () => {
    const envelope = dropEnvelope() as unknown as Record<string, unknown>;
    const detail = { ...(envelope['detail'] as Record<string, unknown>) };
    delete detail['observationOrdinal'];
    envelope['detail'] = detail;

    expect(validateEnvelope(envelope).ok).toBe(false);
  });
});
