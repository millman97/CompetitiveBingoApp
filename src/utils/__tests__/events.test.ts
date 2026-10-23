import { describe, expect, it } from 'vitest';
import type { PublicGameSummary } from '../../model/domain/Game/PublicGame';
import { matchesEventFilter, orderEvents } from '../events';

describe('event discovery', () => {
  it('puts live events first, upcoming events in start order, and finished events last', () => {
    const events = [
      { id: 'later', state: 'UPCOMING', starts_at: 4000 },
      { id: 'finished', state: 'ENDED', starts_at: 500 },
      { id: 'next', state: 'UPCOMING', starts_at: 3000 },
      { id: 'live', state: 'LIVE', starts_at: 1000 },
    ] as PublicGameSummary[];
    expect(orderEvents(events).map((event) => event.id)).toEqual([
      'live',
      'next',
      'later',
      'finished',
    ]);
    expect(events[0]?.id).toBe('later');
  });

  it('keeps paused and sudden-death games discoverable in progress', () => {
    expect(matchesEventFilter('LOCKED', 'active')).toBe(true);
    expect(matchesEventFilter('SUDDEN_DEATH', 'active')).toBe(true);
    expect(matchesEventFilter('ENDED', 'active')).toBe(false);
    expect(matchesEventFilter('UPCOMING', 'upcoming')).toBe(true);
    expect(matchesEventFilter('LIVE', 'ended')).toBe(false);
  });
});
