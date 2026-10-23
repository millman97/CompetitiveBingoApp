/**
 * Turns what an organiser typed into a metric ID.
 *
 * The same normalisation the plugin applies to an activity name: lowercase, runs of anything else
 * collapsed to underscores. So "Drops worth 1m or more" becomes drop.drops_worth_1m_or_more, and
 * nobody has to know that.
 */
export const metricIdFor = (label: string): string => {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug === '' ? '' : `drop.${slug}`;
};
