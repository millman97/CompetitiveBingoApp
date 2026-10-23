// Join codes.
//
// Read aloud in a Discord call and typed by hand into a plugin panel, so they are words and digits
// rather than entropy. They are not a secret worth protecting — every participant gets one — and
// they are entirely separate from the admin password.

const ADJECTIVES = [
  'SWAMP', 'BRONZE', 'RUNE', 'MISTY', 'CRIMSON', 'FROZEN', 'ANCIENT', 'GILDED',
  'SHADOW', 'EMERALD', 'IRON', 'WICKED', 'DUSTY', 'ROYAL', 'GRIMY', 'BRIGHT',
];

const NOUNS = [
  'TOAD', 'KRAKEN', 'GOBLIN', 'DRAGON', 'IMP', 'WYRM', 'GOLEM', 'BASILISK',
  'SPIDER', 'HYDRA', 'ZULRAH', 'JELLY', 'WOLF', 'RAVEN', 'TROLL', 'PHOENIX',
];

const pick = <T>(values: readonly T[]): T =>
  values[Math.floor(Math.random() * values.length)] as T;

/** e.g. SWAMP-TOAD-42. Uppercase, because that is how the plugin compares them. */
export const generateJoinCode = (): string =>
  `${pick(ADJECTIVES)}-${pick(NOUNS)}-${10 + Math.floor(Math.random() * 90)}`;

/**
 * Finds a code nothing else is using.
 *
 * The space is 16 x 16 x 90, which is small — but so is the number of games one clan runs, and a
 * collision only has to be avoided, not made impossible.
 */
export const uniqueJoinCode = async (db: D1Database): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateJoinCode();
    const taken = await db
      .prepare('SELECT 1 AS taken FROM games WHERE join_code = ?')
      .bind(code)
      .first();

    if (taken === null) {
      return code;
    }
  }

  throw new Error('Could not find a free join code.');
};

/** What an admin is allowed to type. Uppercased before comparison, as the plugin does. */
export const JOIN_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$/;

export type JoinCodeProblem = 'FORMAT' | 'TAKEN';

/**
 * Validates a code an admin chose.
 *
 * Codes are read aloud and typed by hand, so the character set is deliberately narrow — letters,
 * digits and dashes. Uniqueness matters because the code is how the plugin finds the game.
 */
export const checkJoinCode = async (
  db: D1Database,
  code: string,
  exceptGameId: string | null,
): Promise<JoinCodeProblem | null> => {
  const normalised = code.trim().toUpperCase();

  if (!JOIN_CODE_PATTERN.test(normalised)) {
    return 'FORMAT';
  }

  const taken = await db
    .prepare('SELECT id FROM games WHERE join_code = ?')
    .bind(normalised)
    .first<{ id: string }>();

  return taken !== null && taken.id !== exceptGameId ? 'TAKEN' : null;
};
