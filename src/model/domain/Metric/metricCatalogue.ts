// A catalogue of metrics an organiser can pick from, with readable labels.
//
// Metric IDs are derived mechanically from what the game says, so the names below produce exactly
// the IDs the plugin sends. The boss list is the official hiscores activity list, which uses the
// same names the game uses in chat; the item list is generated from the collection log.
//
// This is deliberately NOT exhaustive and cannot be. Anything missing can still be named by hand,
// and any metric this game has actually observed is offered alongside these.

import { slugify } from '../../../contract/metrics';
import { ADDITIONAL_DROP_ITEMS } from './additionalDropItems';
import { COLLECTION_ITEMS } from './collectionItems';
import { MONSTER_ITEMS } from './monsterItems';

export { slugify };

export interface CatalogueEntry {
  metricId: string;
  label: string;
  group: string;
}

/** Metric families a tile can ask about, in the order the picker offers them. */
export type MetricFamily = 'COUNTS' | 'MONSTERS' | 'SPEED' | 'DROPS' | 'LOG';

export const FAMILIES: { id: MetricFamily; label: string; prefix: string }[] = [
  // Not only kills: the contract is explicit that completion, chest, harvest, success and lap
  // counts all normalise into kc. too. The prefix records that a metric is a cumulative counter,
  // not that anything died.
  { id: 'COUNTS', label: 'Official counts', prefix: 'kc.' },
  { id: 'MONSTERS', label: 'Monster kills', prefix: 'kill.' },
  { id: 'SPEED', label: 'Speed', prefix: 'time.' },
  { id: 'DROPS', label: 'Drops', prefix: 'drop.' },
  { id: 'LOG', label: 'Log slots', prefix: 'collection_log.' },
];

export const familyOf = (metricId: string): MetricFamily | null =>
  FAMILIES.find((family) => metricId.startsWith(family.prefix))?.id ?? null;

/**
 * Current RuneLite boss/activity names, not invented labels. Verified against the BOSS entries in
 * RuneLite's HiscoreSkill enum; the metric IDs below are the plugin's normal slug of those names.
 * Source: runelite-client/src/main/java/net/runelite/client/hiscore/HiscoreSkill.java
 */
export const KILL_CATALOGUE: CatalogueEntry[] = [
  { metricId: 'kc.abyssal_sire', label: 'Abyssal Sire', group: 'Kill count' },
  {
    metricId: 'kc.alchemical_hydra',
    label: 'Alchemical Hydra',
    group: 'Kill count',
  },
  { metricId: 'kc.amoxliatl', label: 'Amoxliatl', group: 'Kill count' },
  { metricId: 'kc.araxxor', label: 'Araxxor', group: 'Kill count' },
  { metricId: 'kc.artio', label: 'Artio', group: 'Kill count' },
  {
    metricId: 'kc.barrows_chests',
    label: 'Barrows Chests',
    group: 'Kill count',
  },
  { metricId: 'kc.brutus', label: 'Brutus', group: 'Kill count' },
  { metricId: 'kc.bryophyta', label: 'Bryophyta', group: 'Kill count' },
  { metricId: 'kc.callisto', label: 'Callisto', group: 'Kill count' },
  { metricId: 'kc.calvar_ion', label: "Calvar'ion", group: 'Kill count' },
  { metricId: 'kc.cerberus', label: 'Cerberus', group: 'Kill count' },
  {
    metricId: 'kc.chambers_of_xeric',
    label: 'Chambers of Xeric',
    group: 'Kill count',
  },
  {
    metricId: 'kc.chambers_of_xeric_challenge_mode',
    label: 'Chambers of Xeric: Challenge Mode',
    group: 'Kill count',
  },
  {
    metricId: 'kc.chaos_elemental',
    label: 'Chaos Elemental',
    group: 'Kill count',
  },
  { metricId: 'kc.chaos_fanatic', label: 'Chaos Fanatic', group: 'Kill count' },
  {
    metricId: 'kc.commander_zilyana',
    label: 'Commander Zilyana',
    group: 'Kill count',
  },
  {
    metricId: 'kc.corporeal_beast',
    label: 'Corporeal Beast',
    group: 'Kill count',
  },
  {
    metricId: 'kc.crazy_archaeologist',
    label: 'Crazy Archaeologist',
    group: 'Kill count',
  },
  {
    metricId: 'kc.dagannoth_prime',
    label: 'Dagannoth Prime',
    group: 'Kill count',
  },
  { metricId: 'kc.dagannoth_rex', label: 'Dagannoth Rex', group: 'Kill count' },
  {
    metricId: 'kc.dagannoth_supreme',
    label: 'Dagannoth Supreme',
    group: 'Kill count',
  },
  {
    metricId: 'kc.deranged_archaeologist',
    label: 'Deranged Archaeologist',
    group: 'Kill count',
  },
  {
    metricId: 'kc.doom_of_mokhaiotl',
    label: 'Doom of Mokhaiotl',
    group: 'Kill count',
  },
  { metricId: 'kc.duke_sucellus', label: 'Duke Sucellus', group: 'Kill count' },
  {
    metricId: 'kc.the_fractured_archive',
    label: 'The Fractured Archive',
    group: 'Kill count',
  },
  {
    metricId: 'kc.general_graardor',
    label: 'General Graardor',
    group: 'Kill count',
  },
  { metricId: 'kc.giant_mole', label: 'Giant Mole', group: 'Kill count' },
  {
    metricId: 'kc.grotesque_guardians',
    label: 'Grotesque Guardians',
    group: 'Kill count',
  },
  { metricId: 'kc.hespori', label: 'Hespori', group: 'Kill count' },
  {
    metricId: 'kc.kalphite_queen',
    label: 'Kalphite Queen',
    group: 'Kill count',
  },
  {
    metricId: 'kc.king_black_dragon',
    label: 'King Black Dragon',
    group: 'Kill count',
  },
  { metricId: 'kc.kraken', label: 'Kraken', group: 'Kill count' },
  { metricId: 'kc.kree_arra', label: "Kree'Arra", group: 'Kill count' },
  {
    metricId: 'kc.k_ril_tsutsaroth',
    label: "K'ril Tsutsaroth",
    group: 'Kill count',
  },
  { metricId: 'kc.lunar_chests', label: 'Lunar Chests', group: 'Kill count' },
  { metricId: 'kc.mad_angel', label: 'Mad Angel', group: 'Kill count' },
  { metricId: 'kc.maggot_king', label: 'Maggot King', group: 'Kill count' },
  { metricId: 'kc.mimic', label: 'Mimic', group: 'Kill count' },
  { metricId: 'kc.nex', label: 'Nex', group: 'Kill count' },
  { metricId: 'kc.nightmare', label: 'Nightmare', group: 'Kill count' },
  {
    metricId: 'kc.phosani_s_nightmare',
    label: "Phosani's Nightmare",
    group: 'Kill count',
  },
  { metricId: 'kc.obor', label: 'Obor', group: 'Kill count' },
  {
    metricId: 'kc.phantom_muspah',
    label: 'Phantom Muspah',
    group: 'Kill count',
  },
  { metricId: 'kc.sarachnis', label: 'Sarachnis', group: 'Kill count' },
  { metricId: 'kc.scorpia', label: 'Scorpia', group: 'Kill count' },
  { metricId: 'kc.scurrius', label: 'Scurrius', group: 'Kill count' },
  {
    metricId: 'kc.shellbane_gryphon',
    label: 'Shellbane Gryphon',
    group: 'Kill count',
  },
  { metricId: 'kc.skotizo', label: 'Skotizo', group: 'Kill count' },
  { metricId: 'kc.sol_heredit', label: 'Sol Heredit', group: 'Kill count' },
  { metricId: 'kc.spindel', label: 'Spindel', group: 'Kill count' },
  { metricId: 'kc.tempoross', label: 'Tempoross', group: 'Kill count' },
  { metricId: 'kc.the_gauntlet', label: 'The Gauntlet', group: 'Kill count' },
  {
    metricId: 'kc.the_corrupted_gauntlet',
    label: 'The Corrupted Gauntlet',
    group: 'Kill count',
  },
  { metricId: 'kc.the_hueycoatl', label: 'The Hueycoatl', group: 'Kill count' },
  { metricId: 'kc.the_leviathan', label: 'The Leviathan', group: 'Kill count' },
  {
    metricId: 'kc.the_royal_titans',
    label: 'The Royal Titans',
    group: 'Kill count',
  },
  { metricId: 'kc.the_whisperer', label: 'The Whisperer', group: 'Kill count' },
  {
    metricId: 'kc.theatre_of_blood',
    label: 'Theatre of Blood',
    group: 'Kill count',
  },
  {
    metricId: 'kc.theatre_of_blood_hard_mode',
    label: 'Theatre of Blood: Hard Mode',
    group: 'Kill count',
  },
  {
    metricId: 'kc.thermonuclear_smoke_devil',
    label: 'Thermonuclear Smoke Devil',
    group: 'Kill count',
  },
  {
    metricId: 'kc.tombs_of_amascut',
    label: 'Tombs of Amascut',
    group: 'Kill count',
  },
  {
    metricId: 'kc.tombs_of_amascut_expert_mode',
    label: 'Tombs of Amascut: Expert Mode',
    group: 'Kill count',
  },
  { metricId: 'kc.tzkal_zuk', label: 'TzKal-Zuk', group: 'Kill count' },
  { metricId: 'kc.tztok_jad', label: 'TzTok-Jad', group: 'Kill count' },
  { metricId: 'kc.vardorvis', label: 'Vardorvis', group: 'Kill count' },
  { metricId: 'kc.venenatis', label: 'Venenatis', group: 'Kill count' },
  { metricId: 'kc.vet_ion', label: "Vet'ion", group: 'Kill count' },
  { metricId: 'kc.vorkath', label: 'Vorkath', group: 'Kill count' },
  { metricId: 'kc.wintertodt', label: 'Wintertodt', group: 'Kill count' },
  { metricId: 'kc.yama', label: 'Yama', group: 'Kill count' },
  { metricId: 'kc.zalcano', label: 'Zalcano', group: 'Kill count' },
  { metricId: 'kc.zulrah', label: 'Zulrah', group: 'Kill count' },
];

/**
 * Activity completions that are not kills.
 *
 * The count families all share the kc. prefix, so anything the game gives a running total for
 * belongs here. The list is short because it is evidence-led: the Hallowed Sepulchre gets its own
 * branch in the plugin's CountParser, so its floors are certain.
 *
 * Several activities that obviously ought to be here are not, because they announce themselves in
 * shapes the plugin does not read — the Guardians of the Rift says "Amount of Rifts you have
 * closed", Hunter rumours say "You have completed N rumours", and the Grand Hallowed Coffin says
 * "You have opened it N times". None match "Your <activity> count is: N", so no event is produced
 * at all. Adding them is a plugin change, not a catalogue entry.
 */
const COMPLETIONS: CatalogueEntry[] = [1, 2, 3, 4, 5].map((floor) => ({
  metricId: `kc.hallowed_sepulchre_floor_${floor}`,
  label: `Hallowed Sepulchre Floor ${floor}`,
  group: 'Activity completions',
}));

/** Sorted by what is written on the row, because that is what a scrolling eye is reading. */
const byLabel = (a: CatalogueEntry, b: CatalogueEntry): number =>
  a.label.localeCompare(b.label);

export const KILLS_AND_COMPLETIONS: CatalogueEntry[] = [
  ...KILL_CATALOGUE,
  ...COMPLETIONS,
].sort(byLabel);

/**
 * Common server-observed monster-kill suggestions. This list is explicitly non-exhaustive; the
 * picker derives a valid kill.<slug> ID from any custom NPC name an organiser enters.
 */
export const MONSTER_KILL_CATALOGUE: CatalogueEntry[] = MONSTER_ITEMS.map(
  (monster) => ({
    metricId: `kill.${slugify(monster.name)}`,
    label: monster.name,
    group: monster.group,
  })
).sort(byLabel);

/**
 * Speed metrics, and only the ones that certainly work.
 *
 * There is no list of activities that report a time, because the plugin does not work from one —
 * it recognises message shapes, and which activities produce them is the game's business. So this
 * is deliberately short and every entry is evidenced: a branch in the plugin's DurationParser, an
 * entry in its alias map, or a fixture in its own tests.
 *
 * Bosses that print "Fight duration:" work too, and are attributed by the kill-count message on
 * the same tick — but which bosses those are is not written down anywhere this repository can
 * check. Offering a guessed list would be worse than offering none: a speed tile for a boss that
 * never reports a time is not an error, it is a tile that silently cannot be scored. Those are
 * typed in by name instead, where the derived id is at least visible before it is committed to.
 */
export const SPEED_CATALOGUE: CatalogueEntry[] = [
  // Raids announce their own completion time, or report it against the raid's own kill count.
  {
    metricId: 'time.chambers_of_xeric',
    label: 'Chambers of Xeric',
    group: 'Raid',
  },
  {
    metricId: 'time.chambers_of_xeric_challenge_mode',
    label: 'Chambers of Xeric: Challenge Mode',
    group: 'Raid',
  },
  {
    metricId: 'time.theatre_of_blood',
    label: 'Theatre of Blood',
    group: 'Raid',
  },
  {
    metricId: 'time.theatre_of_blood_hard_mode',
    label: 'Theatre of Blood: Hard Mode',
    group: 'Raid',
  },
  {
    metricId: 'time.theatre_of_blood_the_final_challenge_normal_mode',
    label: 'Theatre of Blood: The Final Challenge (Normal Mode)',
    group: 'Theatre of Blood wave',
  },
  {
    metricId: 'time.tombs_of_amascut',
    label: 'Tombs of Amascut',
    group: 'Raid',
  },
  {
    metricId: 'time.tombs_of_amascut_expert_mode',
    label: 'Tombs of Amascut: Expert Mode',
    group: 'Raid',
  },
  {
    metricId: 'time.the_fractured_archive',
    label: 'The Fractured Archive',
    group: 'Raid',
  },

  // "Challenge duration:" and "Corrupted challenge duration:". The ids are the plugin's aliases,
  // not the kill count's: its counter says "Gauntlet" where its timer says "The Gauntlet".
  { metricId: 'time.gauntlet', label: 'The Gauntlet', group: 'The Gauntlet' },
  {
    metricId: 'time.corrupted_gauntlet',
    label: 'The Corrupted Gauntlet',
    group: 'The Gauntlet',
  },

  // The one activity that reports two times at once, and the only one with its own parser branch.
  {
    metricId: 'time.hallowed_sepulchre',
    label: 'Hallowed Sepulchre (overall)',
    group: 'Hallowed Sepulchre',
  },
  ...[1, 2, 3, 4, 5].map((floor) => ({
    metricId: `time.hallowed_sepulchre_floor_${floor}`,
    label: `Hallowed Sepulchre Floor ${floor}`,
    group: 'Hallowed Sepulchre',
  })),

  // "Subdued in 3:21", paired with the subdued count on the same tick.
  { metricId: 'time.wintertodt', label: 'Wintertodt', group: 'Skilling boss' },
  { metricId: 'time.tempoross', label: 'Tempoross', group: 'Skilling boss' },

  // Current game messages use "Lap duration" and identify these activities in the paired count.
  {
    metricId: 'time.colossal_wyrm_agility_course',
    label: 'Colossal Wyrm Agility Course',
    group: 'Agility course',
  },
  {
    metricId: 'time.colossal_wyrm_agility_course_advanced',
    label: 'Colossal Wyrm Agility Course (Advanced)',
    group: 'Agility course',
  },
  { metricId: 'time.sledding', label: 'Sledding', group: 'Race' },
].sort(byLabel);

/**
 * Drop suggestions from the generated collection-log dataset plus maintained common non-log
 * items. Observed metrics and a custom-name fallback are merged into this list by MetricPicker,
 * so the absence of a name here never prevents an organiser tracking it.
 */
export const DROP_CATALOGUE: CatalogueEntry[] = [
  ...COLLECTION_ITEMS.map((item) => ({
    metricId: `drop.${slugify(item.name)}`,
    label: item.name,
    group: item.group,
  })),
  ...ADDITIONAL_DROP_ITEMS.map((item) => ({
    metricId: `drop.${slugify(item.name)}`,
    label: item.name,
    group: item.group,
  })),
]
  .filter(
    (entry, index, all) =>
      all.findIndex((candidate) => candidate.metricId === entry.metricId) ===
      index
  )
  .sort(byLabel);

export const ANY_DROP = 'drop.*';
export const ANY_LOG_SLOT = 'collection_log.*';

export const WILDCARDS: CatalogueEntry[] = [
  { metricId: ANY_DROP, label: 'Any drop', group: 'Wildcard' },
  {
    metricId: ANY_LOG_SLOT,
    label: 'Any new collection log slot',
    group: 'Wildcard',
  },
];

/**
 * What the picker offers for each family.
 *
 * Log slots is one entry on purpose. Asking a team for a named item's log slot is both harsher
 * than asking for the drop — it counts only somebody's first-ever unlock, so anyone who already
 * owns the item cannot score it — and far more restrictive than what these tiles are for, which
 * is "get three new things". The count comes from the tile's own target.
 */
export const CATALOGUE_FOR: Record<MetricFamily, CatalogueEntry[]> = {
  COUNTS: KILLS_AND_COMPLETIONS,
  MONSTERS: MONSTER_KILL_CATALOGUE,
  SPEED: SPEED_CATALOGUE,
  DROPS: [WILDCARDS[0] as CatalogueEntry, ...DROP_CATALOGUE],
  LOG: [WILDCARDS[1] as CatalogueEntry],
};

export const METRIC_CATALOGUE: CatalogueEntry[] = [
  ...KILLS_AND_COMPLETIONS,
  ...MONSTER_KILL_CATALOGUE,
  ...SPEED_CATALOGUE,
  ...DROP_CATALOGUE,
  ...WILDCARDS,
];

/** Label for a metric ID, falling back to the ID itself for anything hand-typed. */
export const labelFor = (metricId: string): string =>
  METRIC_CATALOGUE.find((entry) => entry.metricId === metricId)?.label ??
  metricId;
