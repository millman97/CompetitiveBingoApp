// Common monsters whose kills can be observed from RuneLite's server NPC-loot signal.
//
// This is intentionally a maintained set of suggestions rather than a claim to enumerate every
// NPC in the game. The metric picker always offers a custom-name fallback, so newly released and
// obscure monsters remain trackable without waiting for this list to be updated.

export interface MonsterItem {
  /** RuneLite NPC composition name, before metric slugification. */
  name: string;
  group: string;
}

export const MONSTER_ITEMS: MonsterItem[] = [
  { name: 'Aberrant spectre', group: 'Slayer monster' },
  { name: 'Abyssal demon', group: 'Slayer monster' },
  { name: 'Ankou', group: 'Monster' },
  { name: 'Banshee', group: 'Slayer monster' },
  { name: 'Basilisk', group: 'Slayer monster' },
  { name: 'Basilisk Knight', group: 'Slayer monster' },
  { name: 'Black demon', group: 'Monster' },
  { name: 'Bloodveld', group: 'Slayer monster' },
  { name: 'Cave horror', group: 'Slayer monster' },
  { name: 'Cockatrice', group: 'Slayer monster' },
  { name: 'Crawling Hand', group: 'Slayer monster' },
  { name: 'Dark beast', group: 'Slayer monster' },
  { name: 'Demonic gorilla', group: 'Demonic creature' },
  { name: 'Dust devil', group: 'Slayer monster' },
  { name: 'Elf', group: 'Monster' },
  { name: 'Fever spider', group: 'Slayer monster' },
  { name: 'Fire giant', group: 'Giant' },
  { name: 'Flesh Crawler', group: 'Monster' },
  { name: 'Gargoyle', group: 'Slayer monster' },
  { name: 'Greater demon', group: 'Monster' },
  { name: 'Hellhound', group: 'Monster' },
  { name: 'Hydra', group: 'Slayer monster' },
  { name: 'Ice giant', group: 'Giant' },
  { name: 'Jelly', group: 'Slayer monster' },
  { name: 'Kurask', group: 'Slayer monster' },
  { name: 'Lizardman shaman', group: 'Lizardman' },
  { name: 'Moss giant', group: 'Giant' },
  { name: 'Mountain troll', group: 'Troll' },
  { name: 'Nechryael', group: 'Slayer monster' },
  { name: 'Nuclear smoke devil', group: 'Slayer monster' },
  { name: 'Pyrefiend', group: 'Slayer monster' },
  { name: 'Rockslug', group: 'Slayer monster' },
  { name: 'Skeletal Wyvern', group: 'Slayer monster' },
  { name: 'Smoke devil', group: 'Slayer monster' },
  { name: 'Spiritual mage', group: 'God Wars Dungeon' },
  { name: 'Spiritual ranger', group: 'God Wars Dungeon' },
  { name: 'Spiritual warrior', group: 'God Wars Dungeon' },
  { name: 'Suqah', group: 'Monster' },
  { name: 'Tormented Demon', group: 'Demonic creature' },
  { name: 'Turoth', group: 'Slayer monster' },
  { name: 'Warped terrorbird', group: 'Slayer monster' },
  { name: 'Waterfiend', group: 'Monster' },
  { name: 'Wyrm', group: 'Slayer monster' },
  { name: 'Zombie', group: 'Monster' },
  { name: 'Zygomite', group: 'Slayer monster' },

  { name: 'Adamant dragon', group: 'Dragon' },
  { name: 'Black dragon', group: 'Dragon' },
  { name: 'Blue dragon', group: 'Dragon' },
  { name: 'Brutal black dragon', group: 'Dragon' },
  { name: 'Green dragon', group: 'Dragon' },
  { name: 'Iron dragon', group: 'Dragon' },
  { name: 'Mithril dragon', group: 'Dragon' },
  { name: 'Red dragon', group: 'Dragon' },
  { name: 'Rune dragon', group: 'Dragon' },
  { name: 'Steel dragon', group: 'Dragon' },

  { name: 'Revenant cyclops', group: 'Revenant' },
  { name: 'Revenant dark beast', group: 'Revenant' },
  { name: 'Revenant demon', group: 'Revenant' },
  { name: 'Revenant dragon', group: 'Revenant' },
  { name: 'Revenant hellhound', group: 'Revenant' },
  { name: 'Revenant knight', group: 'Revenant' },
  { name: 'Revenant ork', group: 'Revenant' },
].sort((a, b) => a.name.localeCompare(b.name));
