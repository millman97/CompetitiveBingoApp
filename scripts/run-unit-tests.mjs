import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep Vitest's temporary transforms inside this workspace on sandboxed Windows.
const tempDirectory = resolve('.cache/unit-tests');
mkdirSync(tempDirectory, { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--config',
    'vitest.unit.config.ts',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 60_000,
    env: {
      ...process.env,
      TEMP: tempDirectory,
      TMP: tempDirectory,
      TMPDIR: tempDirectory,
    },
  }
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
