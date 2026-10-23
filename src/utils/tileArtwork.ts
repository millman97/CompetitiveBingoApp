import icons from '../assets/hiscore-icons.json';
import { isValueAggregate } from '../worker/scoring/value-tiles';

export interface Artwork {
  source: string;
  kind: 'challenge' | 'clock' | 'collection' | 'loot' | 'coins';
}

const aliases: Record<string, string> = {
  gauntlet: 'thegauntlet',
  corruptedgauntlet: 'thecorruptedgauntlet',
  theatreofbloodthefinalchallengenormalmode: 'theatreofblood',
};
const iconSources: Record<string, string> = icons;

const metricSource = (metric: string): string | undefined => {
  const [family, name = ''] = metric.split('.');
  if (family === 'collection_log')
    return iconSources['activity:collectionslogged'];
  if (!['kc', 'kill', 'time'].includes(family ?? '')) return undefined;
  if (
    name.startsWith('hallowed_sepulchre') ||
    name.startsWith('colossal_wyrm_agility_course')
  )
    return iconSources['skill:agility'];
  const key = name.replaceAll('_', '');
  return iconSources['activity:' + (aliases[key] ?? key)];
};

/** The configured metrics determine the picture; editable tile labels never do. */
export const artworkFor = (
  metrics: readonly string[] = [],
  aggregate = 'SUM',
  valueBased = false
): Artwork => {
  if (
    valueBased ||
    isValueAggregate(aggregate) ||
    (metrics.length === 1 && metrics[0] === 'drop.coins')
  )
    return { source: '/images/osrs/items/coins.png', kind: 'coins' };
  const sources = metrics.map(metricSource);
  if (
    sources.length > 0 &&
    sources[0] &&
    sources.every((source) => source === sources[0])
  ) {
    return { source: sources[0], kind: 'challenge' };
  }
  if (
    metrics.length &&
    metrics.every((metric) => metric.startsWith('collection_log.'))
  )
    return {
      source: '/images/osrs/hiscores/collectionslogged.png',
      kind: 'collection',
    };
  if (aggregate === 'MIN_DURATION')
    return { source: '/images/osrs/items/clock.png', kind: 'clock' };
  if (metrics.length && metrics.every((metric) => metric.startsWith('drop.')))
    return { source: '/images/osrs/items/loot-bag.png', kind: 'loot' };
  return aggregate === 'UNIQUE'
    ? { source: iconSources['activity:collectionslogged']!, kind: 'collection' }
    : { source: '/images/osrs/skills/combat.png', kind: 'challenge' };
};
