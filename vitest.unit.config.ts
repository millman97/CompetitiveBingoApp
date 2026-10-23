import { defineConfig } from 'vitest/config';

// Deliberately separate from the Workers/D1 test harness. No runtime or services.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/*.test.ts'],
  },
});
