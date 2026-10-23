import type { PublicGameSummary } from '../model/domain/Game/PublicGame';

export const EVENT_FILTERS = [
  { id: 'all', label: 'All events' },
  { id: 'active', label: 'In progress' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'ended', label: 'Finished' },
] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number]['id'];

export const matchesEventFilter = (state: string, filter: EventFilter) =>
  filter === 'all' ||
  (filter === 'active'
    ? ['LIVE', 'SUDDEN_DEATH', 'LOCKED'].includes(state)
    : filter === 'upcoming'
      ? state === 'UPCOMING'
      : state === 'ENDED');

const STATE_ORDER: Record<string, number> = {
  LIVE: 0,
  SUDDEN_DEATH: 0,
  LOCKED: 1,
  UPCOMING: 2,
  ENDED: 3,
};

export const orderEvents = <T extends PublicGameSummary>(
  events: readonly T[]
): T[] =>
  [...events].sort(
    (a, b) =>
      (STATE_ORDER[a.state] ?? 4) - (STATE_ORDER[b.state] ?? 4) ||
      (a.state === 'UPCOMING'
        ? a.starts_at - b.starts_at
        : b.starts_at - a.starts_at)
  );
