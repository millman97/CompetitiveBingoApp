// Generates everything derived from the vendored contract schemas:
//
//   src/generated/contract-types.ts  - TypeScript types
//   src/generated/validators.js     - precompiled Ajv validators
//   src/generated/validators.d.ts    - their signatures
//
// Both outputs are generated rather than hand-written, because a hand-written copy of a schema
// shape is a second source of truth that drifts. Nothing in src/generated is edited by hand and
// the whole directory is gitignored.
//
// The validators are *precompiled*. Ajv normally builds its validate function with
// `new Function` at runtime, which Cloudflare Workers forbid outright, so the standalone code
// generator is not an optimisation here — it is the only way Ajv runs on this platform at all.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { compile } from 'json-schema-to-typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractDir = join(root, 'contract');
const outDir = join(root, 'src', 'generated');

const BANNER = `/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Produced by scripts/generate-contract.mjs from the vendored contract schemas in contract/.
 * Those schemas are copied verbatim from the RuneLite plugin repository and are authoritative
 * for everything on the wire. To change a shape here, change the plugin and re-vendor.
 *
 * Run: npm run generate
 */`;

const readSchema = async (name) => JSON.parse(await readFile(join(contractDir, name), 'utf8'));

const eventSchema = await readSchema('event.schema.json');
const gameConfigSchema = await readSchema('game-config.schema.json');

await mkdir(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const typeOptions = {
  bannerComment: '',
  declareExternallyReferenced: true,
  unreachableDefinitions: true,
  additionalProperties: false,
  style: { singleQuote: true, printWidth: 100 },
};

const eventTypes = await compile(eventSchema, 'EventEnvelopeBase', typeOptions);
const gameConfigTypes = await compile(gameConfigSchema, 'GameConfig', typeOptions);

await writeFile(
  join(outDir, 'contract-types.ts'),
  `${BANNER}\n\n/* eslint-disable */\n\n${eventTypes}\n${gameConfigTypes}`,
  'utf8',
);

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const ajv = new Ajv2020.default({
  code: { source: true, esm: true },
  // allErrors so an INVALID rejection can be logged with every reason at once. A malformed
  // envelope is a bug in one of the two repos, and one error at a time makes it slower to find.
  allErrors: true,
  // The schemas are vendored and not ours to adjust, so schema-authoring warnings are noise.
  // This does not relax how strictly *data* is checked.
  strict: false,
});

ajv.addSchema(eventSchema, 'event');
ajv.addSchema(gameConfigSchema, 'gameConfig');

const source = standaloneCode.default(ajv, {
  validateEventEnvelope: 'event',
  validateGameConfig: 'gameConfig',
});

await writeFile(join(outDir, 'validators.js'), source, 'utf8');

await writeFile(
  join(outDir, 'validators.d.ts'),
  `${BANNER}

export interface ValidationError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

export interface ValidateFunction<T> {
  (data: unknown): data is T;
  errors?: ValidationError[] | null;
}

export const validateEventEnvelope: ValidateFunction<unknown>;
export const validateGameConfig: ValidateFunction<unknown>;
`,
  'utf8',
);

console.log('generated: contract-types.ts, validators.js, validators.d.ts');
