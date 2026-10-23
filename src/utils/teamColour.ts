/** Eight distinct hues, cycled so two teams never start out the same colour. */
export const TEAM_COLOURS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#06b6d4',
  '#f97316',
  '#ec4899',
];

/**
 * The next colour nothing is using.
 *
 * Falls back to cycling once every colour is taken — eight teams is already more than a clan
 * bingo runs, and a repeat is better than an unreadable near-match.
 */
export const nextTeamColour = (taken: string[]): string => {
  const used = new Set(taken.map((colour) => colour.toLowerCase()));
  return (
    TEAM_COLOURS.find((colour) => !used.has(colour.toLowerCase())) ??
    (TEAM_COLOURS[taken.length % TEAM_COLOURS.length] as string)
  );
};
