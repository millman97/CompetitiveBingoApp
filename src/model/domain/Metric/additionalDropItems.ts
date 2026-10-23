// Useful non-collection-log item suggestions.
//
// There is no complete item-definition dataset vendored in this repository. These entries are
// merged with the generated collection-log catalogue, metrics already observed by this game, and
// the picker's custom-name fallback. That makes every item name usable without presenting this
// maintained convenience list as exhaustive.

export interface AdditionalDropItem {
  name: string;
  group: string;
}

export const ADDITIONAL_DROP_ITEMS: AdditionalDropItem[] = [
  { name: 'Adamantite bar', group: 'Resource' },
  { name: 'Battlestaff', group: 'Resource' },
  { name: 'Blood rune', group: 'Rune' },
  { name: 'Chaos rune', group: 'Rune' },
  { name: 'Coins', group: 'Currency' },
  { name: 'Cosmic rune', group: 'Rune' },
  { name: 'Death rune', group: 'Rune' },
  { name: 'Dragon arrowtips', group: 'Resource' },
  { name: 'Dragon bones', group: 'Bones' },
  { name: 'Dragon dart tip', group: 'Resource' },
  { name: 'Dragon javelin heads', group: 'Resource' },
  { name: 'Dragonstone', group: 'Gem' },
  { name: 'Grimy cadantine', group: 'Herb' },
  { name: 'Grimy dwarf weed', group: 'Herb' },
  { name: 'Grimy irit leaf', group: 'Herb' },
  { name: 'Grimy kwuarm', group: 'Herb' },
  { name: 'Grimy lantadyme', group: 'Herb' },
  { name: 'Grimy ranarr weed', group: 'Herb' },
  { name: 'Grimy snapdragon', group: 'Herb' },
  { name: 'Grimy torstol', group: 'Herb' },
  { name: 'Law rune', group: 'Rune' },
  { name: 'Nature rune', group: 'Rune' },
  { name: 'Onyx bolt tips', group: 'Resource' },
  { name: 'Prayer potion(4)', group: 'Potion' },
  { name: 'Raw manta ray', group: 'Food' },
  { name: 'Raw shark', group: 'Food' },
  { name: 'Rune bar', group: 'Resource' },
  { name: 'Rune platebody', group: 'Equipment' },
  { name: 'Runite ore', group: 'Resource' },
  { name: 'Soul rune', group: 'Rune' },
  { name: 'Super restore(4)', group: 'Potion' },
  { name: 'Uncut diamond', group: 'Gem' },
  { name: 'Uncut dragonstone', group: 'Gem' },
  { name: 'Uncut emerald', group: 'Gem' },
  { name: 'Uncut ruby', group: 'Gem' },
  { name: 'Wrath rune', group: 'Rune' },
].sort((a, b) => a.name.localeCompare(b.name));
