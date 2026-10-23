import type { GameMode } from './Game';

/** Off-plugin activity is a count that jumped further than the plugin watched. */
export const BACKFILL_OPTIONS = [
  { value: 'COUNT', label: 'Credit off-plugin activity' },
  { value: 'IGNORE', label: 'Credit only on-plugin activity' },
  { value: 'FLAG_ONLY', label: 'Credit and flag off-plugin activity' },
];

export const WIN_CONDITIONS = [
  { value: 'FIRST_LINE', label: 'First line wins, immediately' },
  {
    value: 'MOST_AT_DEADLINE',
    label: 'Most lines at the deadline (fallback to most tiles)',
  },
  { value: 'HYBRID_SUDDEN_DEATH', label: 'Sudden death if nobody has a line' },
];

export const MODE_HELP: Record<GameMode, string> = {
  CONTROL:
    'Whoever leads a tile holds it, and ownership flips as others overtake. A tie leaves the tile contested and held by nobody.',
  RUSH: 'The first team to finish a tile takes it and keeps it — being overtaken afterwards means nothing. First line wins; if nobody has one when the clock runs out, or once every tile has been taken, the most tiles wins.',
  CLASSIC:
    'Every team works the same board independently, several teams can complete the same tile, and the final score is tiles plus lines.',
};
