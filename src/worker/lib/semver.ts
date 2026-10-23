// Plugin version comparison for minPluginVersion enforcement.
//
// This mirrors SyncService.isOlder in the plugin, including its leniency: anything unparseable is
// treated as not older. The plugin already refuses to sync when it judges itself too old, so the
// server check is a backstop against a modified or very old client, not the primary gate — and a
// backstop that locks people out over an unexpected version string is worse than one that lets a
// borderline case through to be seen in the roster.

const parts = (version: string): number[] =>
  version.split('.').map((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 ? value : Number.NaN;
  });

/** True when `version` is strictly older than `minimum`. */
export const isOlder = (version: string, minimum: string): boolean => {
  const a = parts(version);
  const b = parts(minimum);

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;

    if (Number.isNaN(left) || Number.isNaN(right)) {
      return false;
    }
    if (left !== right) {
      return left < right;
    }
  }

  return false;
};
