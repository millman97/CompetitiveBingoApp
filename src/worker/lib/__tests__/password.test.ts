import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../password';

const nativeDeriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
const deployedHash =
  'pbkdf2$100000$P5JZ93hlU7HpQjFImpvuRg==$9BhaDqp/TV067vSfLOsWYqdwI0LcT+glhFTM0KE2u34=';

beforeEach(() => {
  // Local workerd does not enforce the production PBKDF2 limit.
  vi.spyOn(crypto.subtle, 'deriveBits').mockImplementation(
    (algorithm, key, length) => {
      const parameters = algorithm as { name: string; iterations: number };
      if (parameters.name === 'PBKDF2' && parameters.iterations > 100_000) {
        throw new DOMException(
          'PBKDF2 iteration limit exceeded',
          'NotSupportedError'
        );
      }
      return nativeDeriveBits(algorithm, key, length);
    }
  );
});

afterEach(() => vi.restoreAllMocks());

describe('passwords in the production Worker', () => {
  it('can hash and verify passwords within the production crypto limit', async () => {
    const password = 'A password with $! "quotes" and 雪';
    const stored = await hashPassword(password);
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword(`${password}!`, stored)).toBe(false);
  });

  it('accepts the hash produced by the deployment password helper', async () => {
    expect(await verifyPassword('pinned-test-password', deployedHash)).toBe(
      true
    );
    expect(await verifyPassword('wrong-test-password', deployedHash)).toBe(
      false
    );
  });

  it('explains how to replace an existing hash above the production limit', async () => {
    await expect(
      verifyPassword('test-password', 'pbkdf2$210000$c2FsdA==$aGFzaA==')
    ).rejects.toThrow(/ADMIN_PASSWORD.*deploy/i);
    expect(crypto.subtle.deriveBits).not.toHaveBeenCalled();
  });
});
