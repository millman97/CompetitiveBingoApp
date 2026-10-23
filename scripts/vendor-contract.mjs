// Re-copies the contract artefacts from the plugin repository into contract/.
//
// The contract is frozen from this repo's point of view: these files are the plugin's, and the
// only legitimate reason to run this is that the plugin has published a new version. Running it
// is therefore a deliberate act with a version bump attached, not part of the build.
//
// Usage: node scripts/vendor-contract.mjs [path-to-plugin-repo]
//        defaults to ../CompetitiveBingo

import { execFileSync } from 'node:child_process';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRepo = resolve(root, process.argv[2] ?? '../CompetitiveBingo');
const contractDir = join(root, 'contract');

const FILES = [
  ['docs/api-contract.md', 'api-contract.md'],
  ['docs/schema/event.schema.json', 'event.schema.json'],
  ['docs/schema/game-config.schema.json', 'game-config.schema.json'],
];

const readPluginVersion = async () => {
  const properties = await readFile(join(pluginRepo, 'runelite-plugin.properties'), 'utf8');
  const match = properties.match(/^version=(.+)$/m);
  if (match === null) {
    throw new Error(`No version= line in ${pluginRepo}/runelite-plugin.properties`);
  }
  return match[1].trim();
};

const readSchemaVersion = async () => {
  const schema = JSON.parse(await readFile(join(contractDir, 'event.schema.json'), 'utf8'));
  const version = schema.properties?.schemaVersion?.const;
  if (typeof version !== 'number') {
    throw new Error('event.schema.json does not pin schemaVersion to a constant');
  }
  return version;
};

for (const [from, to] of FILES) {
  await copyFile(join(pluginRepo, from), join(contractDir, to));
  console.log(`vendored ${to}`);
}

const pluginVersion = await readPluginVersion();
const schemaVersion = await readSchemaVersion();
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: pluginRepo,
  encoding: 'utf8',
}).trim();

await writeFile(
  join(contractDir, 'VERSION'),
  `# Vendored plugin contract artefacts — DO NOT EDIT

These files are copied verbatim from the RuneLite plugin repository. They are the
authoritative definition of everything on the wire. If a change is needed here, that is a
plugin release and a schema version bump, not an implementation detail in this repo.

source-repo:     com.millman97.competitivebingo
plugin-version:  ${pluginVersion}
schema-version:  ${schemaVersion}
plugin-commit:   ${commit}
vendored-at:     ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}

files:
  api-contract.md          <- docs/api-contract.md
  event.schema.json        <- docs/schema/event.schema.json
  game-config.schema.json  <- docs/schema/game-config.schema.json

To re-vendor, run: npm run vendor:contract
`,
  'utf8',
);

console.log(`contract/VERSION updated: plugin ${pluginVersion}, schema ${schemaVersion}, ${commit}`);
console.log('Now run: npm run generate');
