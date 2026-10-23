// The admin panel's metric catalogue.
//
// Everything here guards the same failure: a metric id that differs from the plugin's by one
// character is not rejected by anything. The plugin filters events against the tracked list on the
// client, so a wrong id produces no event, no rejection and no flag — the tile sits at zero and
// nobody finds out until the event is over.

import { describe, expect, it } from 'vitest';

import { ADDITIONAL_DROP_ITEMS } from '../additionalDropItems';
import { COLLECTION_ITEMS } from '../collectionItems';
import {
  ANY_LOG_SLOT,
  CATALOGUE_FOR,
  DROP_CATALOGUE,
  FAMILIES,
  KILLS_AND_COMPLETIONS,
  METRIC_CATALOGUE,
  MONSTER_KILL_CATALOGUE,
  SPEED_CATALOGUE,
  familyOf,
  slugify,
} from '../metricCatalogue';
import { MONSTER_ITEMS } from '../monsterItems';

describe('slugify', () => {
  // Taken from the plugin's own MetricIdsTest, because this is a reimplementation of
  // MetricIds.slug and the two only stay in step if the same cases are pinned on both sides.
  it('matches the plugin, case for case', () => {
    expect(slugify('Chambers of Xeric: Challenge Mode')).toBe(
      'chambers_of_xeric_challenge_mode'
    );
    expect(slugify('Hallowed Sepulchre Floor 5')).toBe(
      'hallowed_sepulchre_floor_5'
    );
    expect(slugify('Vorkath')).toBe('vorkath');
  });

  it('collapses runs of punctuation and trims the ends', () => {
    expect(slugify("Vet'ion")).toBe('vet_ion');
    expect(slugify("Kree'arra")).toBe('kree_arra');
    expect(slugify('  Twisted bow  ')).toBe('twisted_bow');
    expect(slugify('Pharaoh’s sceptre (uncharged)')).toBe(
      'pharaoh_s_sceptre_uncharged'
    );
  });

  it('gives nothing back for a name with nothing usable in it', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });
});

describe('the catalogue', () => {
  it('gives every entry an id in its own family', () => {
    for (const family of FAMILIES) {
      for (const entry of CATALOGUE_FOR[family.id]) {
        expect(entry.metricId.startsWith(family.prefix)).toBe(true);
        expect(familyOf(entry.metricId)).toBe(family.id);
      }
    }
  });

  it('has no duplicate ids within a family', () => {
    for (const family of FAMILIES) {
      const ids = CATALOGUE_FOR[family.id].map((entry) => entry.metricId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('derives every item id by the slug rule, and never ships an empty one', () => {
    for (const entry of DROP_CATALOGUE) {
      const [, name] = entry.metricId.split(/\.(.*)/s);
      expect(name).toBe(slugify(entry.label));
      expect(name).not.toBe('');
    }
  });

  it('merges collection-log and common non-log drop suggestions without duplicates', () => {
    expect(DROP_CATALOGUE.length).toBeGreaterThanOrEqual(
      COLLECTION_ITEMS.length
    );
    for (const item of ADDITIONAL_DROP_ITEMS) {
      expect(DROP_CATALOGUE.map((entry) => entry.metricId)).toContain(
        `drop.${slugify(item.name)}`
      );
    }
    expect(new Set(DROP_CATALOGUE.map((entry) => entry.metricId)).size).toBe(
      DROP_CATALOGUE.length
    );
  });

  it('offers a maintained monster catalogue in its own delta-only family', () => {
    expect(MONSTER_KILL_CATALOGUE).toHaveLength(MONSTER_ITEMS.length);
    expect(MONSTER_KILL_CATALOGUE.map((entry) => entry.metricId)).toContain(
      'kill.abyssal_demon'
    );
    expect(familyOf('kill.abyssal_demon')).toBe('MONSTERS');
    expect(familyOf('kc.vorkath')).toBe('COUNTS');
  });

  // Asking for a named item's log slot counts only somebody's first-ever unlock, so anyone who
  // already owns it cannot score the tile. These tiles are for "get three new things", and the
  // three comes from the tile's target.
  it('offers log slots as a count and nothing else', () => {
    expect(CATALOGUE_FOR.LOG.map((entry) => entry.metricId)).toEqual([
      ANY_LOG_SLOT,
    ]);
  });

  // The Gauntlet's counter says "Gauntlet" and its timer says "The Gauntlet", so the plugin's
  // alias map settles on one id for the activity — and it is not the one the kill count uses.
  // Re-prefixing the kill count would give time.the_gauntlet, which nothing ever sends.
  it('uses the plugin alias for the Gauntlet times', () => {
    const ids = SPEED_CATALOGUE.map((entry) => entry.metricId);

    expect(ids).toContain('time.gauntlet');
    expect(ids).toContain('time.corrupted_gauntlet');
    expect(ids).not.toContain('time.the_gauntlet');
    expect(ids).not.toContain('time.the_corrupted_gauntlet');
  });

  // Every speed metric has to be traceable to something the plugin actually reads: a branch in
  // its DurationParser, an entry in its alias map, or a fixture in its own tests. A guessed one
  // is not an error anybody sees — it is a tile that silently cannot be scored.
  it('offers only speed metrics that are certain to arrive', () => {
    expect(SPEED_CATALOGUE.map((entry) => entry.metricId).sort()).toEqual(
      [
        'time.chambers_of_xeric',
        'time.chambers_of_xeric_challenge_mode',
        'time.colossal_wyrm_agility_course',
        'time.colossal_wyrm_agility_course_advanced',
        'time.corrupted_gauntlet',
        'time.gauntlet',
        'time.hallowed_sepulchre',
        'time.hallowed_sepulchre_floor_1',
        'time.hallowed_sepulchre_floor_2',
        'time.hallowed_sepulchre_floor_3',
        'time.hallowed_sepulchre_floor_4',
        'time.hallowed_sepulchre_floor_5',
        'time.sledding',
        'time.tempoross',
        'time.the_fractured_archive',
        'time.theatre_of_blood',
        'time.theatre_of_blood_hard_mode',
        'time.theatre_of_blood_the_final_challenge_normal_mode',
        'time.tombs_of_amascut',
        'time.tombs_of_amascut_expert_mode',
        'time.wintertodt',
      ].sort()
    );
  });

  // Contract section 3.1: completion, chest, harvest, success and lap counts all normalise into
  // kc. as well, so a counter that has nothing to do with killing still belongs in that family.
  it('offers activity completions alongside kills', () => {
    const ids = KILLS_AND_COMPLETIONS.map((entry) => entry.metricId);

    expect(ids).toContain('kc.vorkath');
    expect(ids).toContain('kc.the_fractured_archive');
    expect(ids).toContain('kc.hallowed_sepulchre_floor_5');
  });

  it('includes the wildcards, which are the only two the contract allows', () => {
    const ids = METRIC_CATALOGUE.map((entry) => entry.metricId);
    expect(ids).toContain('drop.*');
    expect(ids).toContain('collection_log.*');
    expect(ids.filter((id) => id.includes('*'))).toHaveLength(2);
  });
});
