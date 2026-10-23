// Small formatting helpers, kept out of the components so they can be read at a glance.

/** A colour at partial strength, for tinting a tile with its owner's colour. */
export const tint = (hex: string, alpha: number): string => {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;

  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);

  if ([r, g, b].some(Number.isNaN)) {
    return `rgba(120, 120, 120, ${alpha})`;
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Time left, counted down the way the plugin's own panel does it: seconds under a minute, then
 * minutes, hours and days.
 */
export const timeRemaining = (endsAt: number, now: number): string => {
  const left = endsAt - now;

  if (left <= 0) {
    return 'time up';
  }

  const seconds = Math.floor(left / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

/** "just now", "4m ago" — the feed reads better in relative time than in clock time. */
export const ago = (at: number, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));

  if (seconds < 10) {
    return 'just now';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
};

export const duration = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/**
 * A player's name, or a stand-in.
 *
 * The plugin sends an empty name when the client has not filled one in yet, so a row can exist
 * before anybody knows what to call it. It corrects itself on that player's next sync.
 */
export const playerName = (name: string): string =>
  name.trim() === '' ? '(no name yet)' : name;
