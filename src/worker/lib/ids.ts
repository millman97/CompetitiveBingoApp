// Identifier generation.
//
// Join codes are read aloud in a Discord call and typed into RuneLite by hand, so they are
// word-word-number rather than random hex. They are distributed to every participant and are
// not a secret — they are entirely separate from the admin password.

const ALPHABET = '0123456789abcdef';

const randomHex = (bytes: number): string => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let out = '';
  for (const value of values) {
    out += ALPHABET[(value >> 4) & 0xf];
    out += ALPHABET[value & 0xf];
  }
  return out;
};

/** Matches the contract's worked example shape, e.g. g_7f3a91. */
export const newGameId = (): string => `g_${randomHex(3)}`;
export const newTeamId = (): string => `t_${randomHex(4)}`;
export const newPlayerId = (): string => `p_${randomHex(6)}`;
export const newTileId = (): string => `tile_${randomHex(6)}`;
export const newFlagId = (): string => `f_${randomHex(8)}`;
export const newActionId = (): string => `a_${randomHex(8)}`;

// Deliberately avoids letters and words that are misheard or mistyped. No I/O/1/0 confusion,
// because someone will be reading this out over voice chat.
const WORDS = [
  'SWAMP', 'TOAD', 'RUNE', 'DRAGON', 'ABYSSAL', 'GRAVE', 'BARROWS', 'ZULRAH',
  'VORKATH', 'KRAKEN', 'CHAOS', 'DESERT', 'FALADOR', 'VARROCK', 'LUMBRIDGE',
  'CATHERBY', 'YANILLE', 'KARAMJA', 'WINTER', 'SHARK', 'MANTA', 'WHALE',
  'GRANITE', 'MITHRIL', 'ADAMANT', 'BANDOS', 'ARMADYL', 'SARADOMIN', 'ZAMORAK',
  'PHANTOM', 'MUSPAH', 'HYDRA', 'SIRE', 'CERBERUS', 'THERMY', 'SKOTIZO',
] as const;

const pick = <T>(items: readonly T[]): T => {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] as number;
  return items[index % items.length] as T;
};

/**
 * Generates a join code such as SWAMP-TOAD-42.
 *
 * Uniqueness is enforced by a UNIQUE constraint on games.join_code, not by hoping — the caller
 * retries on a collision.
 */
export const newJoinCode = (): string => {
  const number = ((crypto.getRandomValues(new Uint32Array(1))[0] as number) % 90) + 10;
  return `${pick(WORDS)}-${pick(WORDS)}-${number}`;
};

/** Join codes are compared case-insensitively, because players type them by hand. */
export const normaliseJoinCode = (code: string): string => code.trim().toUpperCase();
