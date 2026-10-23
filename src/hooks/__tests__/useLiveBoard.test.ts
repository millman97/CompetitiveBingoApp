import { describe, expect, it } from 'vitest';

import { socketRetryDelay } from '../useLiveBoard';

describe('live board socket recovery', () => {
  it('has a bounded retry sequence', () => {
    expect([0, 1, 2, 3, 4, 5, 100].map(socketRetryDelay)).toEqual([
      1000,
      2000,
      5000,
      10000,
      30000,
      null,
      null,
    ]);
  });
});
