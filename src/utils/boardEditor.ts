import type { AdminTile } from '../model/domain/Game/Game';

export const emptyTile = (row: number, col: number): AdminTile => ({
  id: `new_${row}_${col}`,
  row,
  col,
  label: '',
  requirement: { metrics: [], aggregate: 'SUM', target: 1 },
});

export const isFilled = (tile: AdminTile): boolean => tile.label.trim() !== '';

export const describeTile = (
  metricId: string,
  name: string,
  target: number
): string => {
  if (metricId.startsWith('kc.')) {
    return `${target} ${name} ${target === 1 ? 'kill' : 'kills'}`;
  }
  if (metricId.startsWith('kill.')) {
    return `${target} ${name} ${target === 1 ? 'kill' : 'kills'}`;
  }
  if (metricId.startsWith('time.')) {
    return `Fastest ${name}`;
  }
  if (metricId.startsWith('collection_log.')) {
    return `${target} × ${name}`;
  }
  return `${target} ${name}`;
};
