// Tile ownership, in the two modes that have it.
//
// CONTROL: the team leading on a tile's metric owns it, and ownership flips continuously as others
// overtake. A tie means the tile is contested and owned by nobody. Sniping is intended behaviour —
// there is no lockout and no stickiness, so a tile taken in the final second is taken.
//
// RUSH: the first team to satisfy the requirement takes the tile, and being overtaken afterwards
// means nothing. There is no such thing as a contested tile in RUSH; the clock separates them.

/** One team's standing on one tile, as aggregated from the event log. */
export interface TeamScore {
  teamId: string;
  score: number;
  /** Whether this team has satisfied the requirement. */
  complete: boolean;
  /** When it first did, which is the whole of the RUSH decision. Null if it has not. */
  completedAt: number | null;
  /** MIN_DURATION only: the fastest run this team has recorded. */
  bestDurationMs: number | null;
  /** Receipt time of that run, so a tie breaks on who got there first. */
  bestAt: number | null;
}

export interface Ownership {
  ownerTeamId: string | null;
  contested: boolean;
}

const UNOWNED: Ownership = { ownerTeamId: null, contested: false };

/**
 * Decides who holds a tile.
 *
 * A tile nobody has scored on is unowned rather than contested. The two are different states and
 * the board shows them differently: contested means several teams are level and fighting over it,
 * unowned means nobody has touched it.
 */
export const resolveOwnership = (
  scores: readonly TeamScore[],
  aggregate: import('./tiles').Aggregate,
): Ownership => {
  if (aggregate === 'MIN_DURATION') {
    const ran = scores.filter((entry) => entry.bestDurationMs !== null);
    if (ran.length === 0) {
      return UNOWNED;
    }

    // Lower is better, and an exact tie on milliseconds is settled by whoever got there first —
    // so a duration tile is never contested.
    const [best] = [...ran].sort((a, b) => {
      const byTime = (a.bestDurationMs as number) - (b.bestDurationMs as number);
      return byTime !== 0 ? byTime : (a.bestAt ?? 0) - (b.bestAt ?? 0);
    });

    return { ownerTeamId: best!.teamId, contested: false };
  }

  const best = Math.max(...scores.map((entry) => entry.score), 0);

  // Nobody has done anything on this tile yet.
  if (best <= 0) {
    return UNOWNED;
  }

  const leaders = scores.filter((entry) => entry.score === best);

  return leaders.length === 1
    ? { ownerTeamId: leaders[0]!.teamId, contested: false }
    : { ownerTeamId: null, contested: true };
};

/**
 * Decides who claimed a tile, in RUSH.
 *
 * Earliest completion wins and nothing takes it back — but this is still a pure function of the
 * stored standings rather than a flag set once and left alone. That matters: an admin discrediting
 * the event that completed a tile has to hand it to whoever was next, and a replay has to reach
 * the same board as live scoring did. A claim that could not be recomputed would survive both.
 *
 * Two teams completing in the same millisecond is possible inside one batch, so the team id is the
 * final tiebreak. It is arbitrary, but it is the same arbitrary answer every time it is asked.
 */
export const resolveClaim = (scores: readonly TeamScore[]): Ownership => {
  const claimed = scores.filter((entry) => entry.complete && entry.completedAt !== null);

  if (claimed.length === 0) {
    return UNOWNED;
  }

  const [first] = [...claimed].sort(
    (a, b) =>
      (a.completedAt as number) - (b.completedAt as number) || a.teamId.localeCompare(b.teamId),
  );

  return { ownerTeamId: first!.teamId, contested: false };
};
