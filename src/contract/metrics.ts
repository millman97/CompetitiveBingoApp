// trackedMetrics matching — contract section 3.3.
//
// Matching is exact string equality, with exactly two wildcards permitted. There is no regular
// expression support, no prefix form, and none will be added: an asterisk anywhere other than
// as one of these two exact strings is a malformed config, and the plugin refuses it outright.

export const COLLECTION_LOG_WILDCARD = 'collection_log.*';
export const DROP_WILDCARD = 'drop.*';

export const WILDCARDS = [COLLECTION_LOG_WILDCARD, DROP_WILDCARD] as const;

/**
 * The plugin's slug rule, mirrored from MetricIds.slug.
 *
 * Lowercase, every run of non-alphanumerics becomes one underscore, then trim the ends. It is
 * mirrored here for the same reason the event id hash is: the plugin derives metric IDs this way
 * and the server has to be able to reach the same answer from the same name.
 *
 * The stakes are one-sided. A metric ID that differs by one character is not rejected by anything
 * — the plugin filters events against the tracked list on the client, so nothing is sent, nothing
 * is rejected, and the tile sits at zero until somebody asks why after the event.
 */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** A metric ID as the plugin normalises them: lowercase and dot-namespaced. */
const METRIC_ID = /^(kc|kill|time|collection_log|drop)\.[a-z0-9_]+$/;

export const isWildcard = (entry: string): boolean =>
  (WILDCARDS as readonly string[]).includes(entry);

/** Whether a single trackedMetrics entry is one the plugin will accept. */
export const isValidTrackedEntry = (entry: string): boolean =>
  isWildcard(entry) || METRIC_ID.test(entry);

/**
 * Whether a metric ID is tracked by this game.
 *
 * A miss produces a NOT_TRACKED rejection, which tells the plugin its copy of trackedMetrics is
 * stale rather than that it is misbehaving.
 */
export const matchesTracked = (metricId: string, tracked: readonly string[]): boolean => {
  for (const entry of tracked) {
    if (entry === metricId) {
      return true;
    }
    if (entry === COLLECTION_LOG_WILDCARD && metricId.startsWith('collection_log.')) {
      return true;
    }
    if (entry === DROP_WILDCARD && metricId.startsWith('drop.')) {
      return true;
    }
  }
  return false;
};

/**
 * Validates a whole trackedMetrics list before it is stored, so a malformed board is rejected in
 * the admin panel rather than discovered by a plugin refusing to sync.
 */
export const invalidTrackedEntries = (tracked: readonly string[]): string[] =>
  tracked.filter((entry) => !isValidTrackedEntry(entry));
