export interface AdminPlayer {
  id: string;
  accountHash: string;
  displayName: string;
  teamId: string | null;
  removedAt: number | null;
  firstSyncedAt: number;
  lastSyncedAt: number;
  ready: boolean | null;
  checks: { id: string; satisfied: boolean }[];
  needsResync: boolean;
}

/**
 * What each readiness check means, and what to do about it.
 *
 * Taken from contract section 9.1. Reporting is all-or-nothing in the plugin — one failed check
 * stops every metric — so a player with any red row here is sending nothing at all, which is
 * exactly the silent whole-event failure this screen exists to catch.
 */
export const CHECK_HELP: Record<string, { name: string; fix: string }> = {
  KILL_COUNT_FILTER: {
    name: 'Boss kill count messages are filtered',
    fix: 'Settings → All Settings → Chat → turn off "Filter out boss kill-count messages". Without it no count ever reaches the chat box.',
  },
  COLLECTION_LOG_NOTIFICATION: {
    name: 'Collection log chat notification is off',
    fix: 'Settings → All Settings → Interfaces → set the collection log notification to chat. The popup-only setting produces no chat line, so nothing is observed.',
  },
  WORLD_TYPE: {
    name: 'On a world type this game does not count',
    fix: 'Hop off seasonal, deadman, beta, tournament and nosave worlds. Members, free and PvP worlds are all fine.',
  },
  LOOT_TRACKER: {
    name: "RuneLite's Loot Tracker plugin is disabled",
    fix: 'Turn the Loot Tracker plugin back on. Drop detection is built on its events, so with it off no drop is detected at all.',
  },
};
