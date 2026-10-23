// Tests run against the real Workers runtime through @cloudflare/vitest-pool-workers, not
// against mocks. D1 semantics, Durable Object semantics and the crypto available in production
// are the things most likely to be wrong, so testing them against a stand-in would test nothing.

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.json' },
      miniflare: {
        // Handed to the setup file, which applies them to the per-test D1 instance.
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
