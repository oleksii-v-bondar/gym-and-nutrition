import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { signAccess, signRefresh, verifyToken } from '../src/auth/tokens.js';

it('hashes and verifies a password', async () => {
  const hash = await hashPassword('s3cret');
  expect(hash).not.toBe('s3cret');
  expect(await verifyPassword('s3cret', hash)).toBe(true);
  expect(await verifyPassword('wrong', hash)).toBe(false);
});

it('signs and verifies access and refresh tokens with type', () => {
  const a = signAccess('user-1');
  const r = signRefresh('user-1');
  expect(verifyToken(a)).toMatchObject({ sub: 'user-1', type: 'access' });
  expect(verifyToken(r)).toMatchObject({ sub: 'user-1', type: 'refresh' });
});
