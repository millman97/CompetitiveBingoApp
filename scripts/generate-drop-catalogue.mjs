// Regenerates the item catalogue from the OSRS Wiki's collection log data.
//
// Run by hand when the game adds content, not as part of the build: the build must work offline
// and in CI, and this needs the network. The generated file is committed.
//
//   node scripts/generate-drop-catalogue.mjs
//
// Item names are copied verbatim from the wiki and never retyped here, because a drop metric ID is
// slug(item name) and the plugin has no alias map for drops. A misspelled name is not rejected by
// anything — the tile simply never scores, and nobody finds out until the event is over. The only
// judgement in this file is which collection log tabs are worth offering; the spelling is data.

import { writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';

const SOURCE =
  'https://oldschool.runescape.wiki/index.php?title=Module:Collection_log/data.json&action=raw';

const OUT = 'src/model/domain/Metric/collectionItems.ts';

/**
 * The collection log tabs worth putting on a bingo board.
 *
 * Named exactly as the wiki names them, so a tab that gets renamed is reported rather than
 * silently dropped. The cut is "uniques, pets and jars": every boss and raid, the slayer table,
 * both pet tabs, and the activities whose rewards people actually race for.
 *
 * Left out: all the Treasure Trails tabs, which are enormous and mostly cosmetic, and the tabs
 * that are a costume, a set of notes or a collection of paints. Anything cut can still be typed
 * in by name.
 */
const TABS = [
  // Raids and the big instanced PvM.
  'Chambers of Xeric',
  'Theatre of Blood',
  'Tombs of Amascut',
  'Fortis Colosseum',
  'The Gauntlet',
  'The Inferno',
  'The Fight Caves',
  'Doom of Mokhaiotl',
  'Yama',
  'Nex',

  // Bosses.
  'Abyssal Sire',
  'Alchemical Hydra',
  'Amoxliatl',
  'Araxxor',
  'Barrows Chests',
  'Brutus',
  'Bryophyta',
  'Callisto and Artio',
  'Cerberus',
  'Chaos Elemental',
  'Chaos Fanatic',
  'Commander Zilyana',
  'Corporeal Beast',
  'Crazy Archaeologist',
  'Cyclopes',
  'Dagannoth Kings',
  'Deranged archaeologist',
  'Duke Sucellus',
  'Elder Chaos Druids',
  'General Graardor',
  'Giant Mole',
  "Glough's Experiments",
  'Grotesque Guardians',
  'Hespori',
  'Kalphite Queen',
  'King Black Dragon',
  'Kraken',
  "Kree'arra",
  "K'ril Tsutsaroth",
  'Maggot King',
  'Moons of Peril',
  'Obor',
  'Phantom Muspah',
  'Revenants',
  'Royal Titans',
  'Sarachnis',
  'Scorpia',
  'Scurrius',
  'Shellbane Gryphon',
  'Skotizo',
  'Tempoross',
  'The Hueycoatl',
  'The Leviathan',
  'The Mad Angel',
  'The Nightmare',
  'The Whisperer',
  'Thermonuclear Smoke Devil',
  'Tormented Demons',
  'TzHaar',
  'Vardorvis',
  'Venators',
  'Venenatis and Spindel',
  "Vet'ion and Calvar'ion",
  'Vorkath',
  'Wintertodt',
  'Zalcano',
  'Zulrah',

  // Everything else people put on a board.
  'Slayer',
  'All Pets',
  'Skilling Pets',
  'Barracuda Trials',
  'Camdozaal',
  "Champion's Challenge",
  'Guardians of the Rift',
  'Hallowed Sepulchre',
  'Miscellaneous',
];

/**
 * The plugin's slug rule, from MetricIds.slug: lowercase, every run of non-alphanumerics becomes
 * one underscore, then trim the ends. Only used here to spot two items that slug to one metric.
 */
const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const response = await fetch(SOURCE, {
  headers: {
    'User-Agent':
      'CompetitiveBingoApp/0.1 one-shot catalogue generator (+https://github.com/millman97/CompetitiveBingoApp)',
  },
});

if (!response.ok) {
  throw new Error(
    `The wiki answered ${response.status} for the collection log data.`
  );
}

const entries = await response.json();
const wanted = new Set(TABS);

const seenTabs = new Set();
const byMetricId = new Map();

for (const entry of entries) {
  for (const tab of entry.tabs ?? []) {
    seenTabs.add(tab);

    if (!wanted.has(tab)) {
      continue;
    }

    const id = slug(entry.name);

    // Several items share a name — eight different "Medallion fragment"s, five "Mysterious
    // page"s. They slug to one metric, which is the right answer: the plugin cannot tell them
    // apart either, because all it ever sees is the name.
    if (id === '' || byMetricId.has(id)) {
      continue;
    }

    byMetricId.set(id, { name: entry.name, group: tab });
  }
}

const missing = TABS.filter((tab) => !seenTabs.has(tab));
if (missing.length > 0) {
  throw new Error(
    `These tabs are no longer in the wiki data, so the list above needs revisiting: ${missing.join(', ')}`
  );
}

const items = [...byMetricId.values()].sort(
  (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)
);

const quote = (value) =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const header = [
  '// Items an organiser can put on a board. GENERATED — do not edit.',
  '//',
  '// Regenerate with: node scripts/generate-drop-catalogue.mjs',
  '//',
  "// Source: the OSRS Wiki's collection log data, cut to the tabs listed in that script — every",
  '// boss and raid, slayer, both pet tabs, and the activities whose rewards people race for.',
  '// Treasure trails and the costume tabs are left out; anything missing can be typed in by name.',
  '//',
  '// Names only. A drop metric and a collection log metric are both slug(item name), so one list',
  '// serves both tabs and the slug happens in one place. Nothing here is hand-typed.',
  '',
  'export interface CollectionItem {',
  '  /** Exactly as the game spells it, which is what the metric id is derived from. */',
  '  name: string;',
  '  /** The collection log tab it came from, shown as the group in the picker. */',
  '  group: string;',
  '}',
  '',
  'export const COLLECTION_ITEMS: CollectionItem[] = [',
].join('\n');

writeFileSync(
  OUT,
  await format(
    `${header}\n${items
      .map(
        (item) =>
          `  { name: ${quote(item.name)}, group: ${quote(item.group)} },`
      )
      .join('\n')}\n];\n`,
    { ...(await resolveConfig(OUT)), filepath: OUT }
  ),
  'utf8'
);

console.log(
  `Wrote ${items.length} items from ${TABS.length} collection log tabs to ${OUT}.`
);
