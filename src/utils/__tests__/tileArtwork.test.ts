import { describe, expect, it } from 'vitest';
import { artworkFor } from '../tileArtwork';

describe('challenge artwork', () => {
  it('matches configured bosses and speed aliases to the official local icons', () => {
    expect(artworkFor(['kc.vorkath']).source).toBe(
      '/images/osrs/hiscores/vorkath.png'
    );
    expect(artworkFor(['time.gauntlet'], 'MIN_DURATION').source).toBe(
      '/images/osrs/hiscores/thegauntlet.png'
    );
    expect(artworkFor(['kc.hallowed_sepulchre_floor_5']).source).toBe(
      '/images/osrs/skills/agility.gif'
    );
  });
  it('uses coins for actual configured value metrics, regardless of the metric name', () => {
    expect(artworkFor(['drop.clan_special'], 'SUM', true)).toEqual({
      source: '/images/osrs/items/coins.png',
      kind: 'coins',
    });
    expect(artworkFor(['drop.clan_special'])).toEqual({
      source: '/images/osrs/items/loot-bag.png',
      kind: 'loot',
    });
  });
  it('uses generic artwork for mixed challenges and old snapshots with no metrics', () => {
    expect(artworkFor(['kc.vorkath', 'kc.zulrah'])).toEqual({
      source: '/images/osrs/skills/combat.png',
      kind: 'challenge',
    });
    expect(artworkFor(undefined, 'MIN_DURATION')).toEqual({
      source: '/images/osrs/items/clock.png',
      kind: 'clock',
    });
  });
  it('uses the collection-log icon for collection targets and a loot bag for item targets', () => {
    expect(artworkFor(['collection_log.*']).source).toBe(
      '/images/osrs/hiscores/collectionslogged.png'
    );
    expect(
      artworkFor(['drop.abyssal_whip', 'drop.abyssal_dagger'], 'UNIQUE').kind
    ).toBe('loot');
  });
  it('uses bundled original coins for both value scoring types without waiting for a saved rule', () => {
    for (const aggregate of ['COUNT_DROPS', 'MAX_VALUE'])
      expect(artworkFor([], aggregate).source).toBe(
        '/images/osrs/items/coins.png'
      );
  });
});
