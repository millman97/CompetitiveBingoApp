// trackedMetrics matching — contract section 3.3. A false positive here means accepting an
// event the plugin should never have sent; a false negative means rejecting a player's real
// progress with NOT_TRACKED.

import { describe, expect, it } from 'vitest';

import { invalidTrackedEntries, isValidTrackedEntry, matchesTracked } from '../src/contract/metrics';

describe('matchesTracked', () => {
  it('matches on exact string equality', () => {
    expect(matchesTracked('kc.vorkath', ['kc.vorkath'])).toBe(true);
    expect(matchesTracked('kc.vorkath', ['kc.zulrah'])).toBe(false);
  });

  it('does not treat an exact entry as a prefix', () => {
    expect(matchesTracked('kc.vorkath_awakened', ['kc.vorkath'])).toBe(false);
  });

  it('matches the two permitted wildcards by family', () => {
    expect(matchesTracked('collection_log.dragon_pickaxe', ['collection_log.*'])).toBe(true);
    expect(matchesTracked('drop.abyssal_whip', ['drop.*'])).toBe(true);
  });

  it('does not let a wildcard cross families', () => {
    expect(matchesTracked('kc.vorkath', ['collection_log.*', 'drop.*'])).toBe(false);
    expect(matchesTracked('drop.abyssal_whip', ['collection_log.*'])).toBe(false);
  });

  it('finds a match anywhere in the list', () => {
    expect(matchesTracked('kc.zulrah', ['kc.vorkath', 'drop.*', 'kc.zulrah'])).toBe(true);
  });

  it('matches nothing against an empty list', () => {
    expect(matchesTracked('kc.vorkath', [])).toBe(false);
  });
});

describe('trackedMetrics validation', () => {
  it('accepts exact IDs in all five families', () => {
    for (const id of [
      'kc.vorkath',
      'kill.abyssal_demon',
      'time.chambers_of_xeric',
      'collection_log.x',
      'drop.y',
    ]) {
      expect(isValidTrackedEntry(id)).toBe(true);
    }
  });

  it('accepts only the two wildcards', () => {
    expect(isValidTrackedEntry('collection_log.*')).toBe(true);
    expect(isValidTrackedEntry('drop.*')).toBe(true);
  });

  // No other wildcard, prefix or pattern form exists. The plugin refuses a config containing
  // one, so the board editor has to refuse it first.
  it('rejects every other asterisk form', () => {
    for (const bad of ['kc.*', '*', 'kc.vork*', '*.vorkath', 'drop.*.rare']) {
      expect(isValidTrackedEntry(bad)).toBe(false);
    }
  });

  it('rejects unknown families and bad casing', () => {
    for (const bad of ['xp.attack', 'KC.VORKATH', 'kc.Vorkath', 'kc.', 'vorkath']) {
      expect(isValidTrackedEntry(bad)).toBe(false);
    }
  });

  it('reports every offending entry at once', () => {
    expect(invalidTrackedEntries(['kc.vorkath', 'kc.*', 'drop.*', 'nope'])).toEqual([
      'kc.*',
      'nope',
    ]);
  });
});
