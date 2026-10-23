import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../src/worker/lib/password';

describe('password hashing', () => {
  it('verifies the password it hashed', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  // Refusing every login for a misconfigured deployment sends an admin hunting for a password
  // that was never the problem. Fail loudly instead.
  it('throws on a stored hash it cannot read', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).rejects.toThrow(/pbkdf2/);
    await expect(verifyPassword('x', 'pbkdf2$notanumber$c2FsdA==$aGFzaA==')).rejects.toThrow(
      /iteration/,
    );
  });
});

// The deploy workflow hashes the admin password with scripts/hash-password.mjs, and this module
// is what verifies it at login. They are separate implementations — Node's webcrypto and the
// Worker's — so this pins them together. If either changes its format or parameters, this fails
// rather than every admin login failing after the next deploy.
describe('interoperability with scripts/hash-password.mjs', () => {
  // Produced by: node scripts/hash-password.mjs "pinned-test-password"
  const FROM_SCRIPT =
    'pbkdf2$210000$P5JZ93hlU7HpQjFImpvuRg==$uJeNMxfdGh3Lr0GdRF3B5a5pyv/yy1f9CEQOA/9XbrY=';

  it('verifies a hash the deploy script produced', async () => {
    expect(await verifyPassword('pinned-test-password', FROM_SCRIPT)).toBe(true);
  });

  it('still rejects a wrong password against that hash', async () => {
    expect(await verifyPassword('pinned-test-passwore', FROM_SCRIPT)).toBe(false);
  });
});
