/** How close to the start an organiser may still move it. Mirrors the server. */
export const START_LOCK_MS = 10_000;

/** An epoch time as a <input type="datetime-local"> value, in the browser's own zone. */
export const toLocalInput = (at: number): string => {
  if (!Number.isFinite(at)) return '';
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fromLocalInput = (value: string): number =>
  new Date(value).getTime();

/** A moment written out the way the organiser's own machine writes it. */
export const formatLocal = (at: number): string | null =>
  Number.isFinite(at)
    ? new Date(at).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

/** Durations in the units an organiser thinks in. */
export const UNITS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
} as const;

export type Unit = keyof typeof UNITS;

/**
 * A length of time as the largest whole unit it divides into.
 *
 * 604800000 comes back as 7 days rather than 168 hours, because that is what was typed to produce
 * it and what the organiser will want to edit.
 */
export const splitDuration = (ms: number): { amount: number; unit: Unit } => {
  for (const unit of ['days', 'hours'] as const) {
    if (ms % UNITS[unit] === 0 && ms >= UNITS[unit]) {
      return { amount: ms / UNITS[unit], unit };
    }
  }
  return {
    amount: Math.max(1, Math.round(ms / UNITS.minutes)),
    unit: 'minutes',
  };
};
