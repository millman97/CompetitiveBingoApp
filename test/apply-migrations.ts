// Applies the real D1 migrations before each test file, so tests run against the same schema a
// deployment gets rather than a hand-maintained copy of it.
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
