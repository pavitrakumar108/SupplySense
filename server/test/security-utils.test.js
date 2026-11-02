import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCookies } from '../src/utils/cookies.js';
import { signAccessToken, verifyAccessToken } from '../src/utils/jwt.js';

const secret = 'local-test-secret-that-is-at-least-32-chars';

describe('security utilities', () => {
  it('signs and verifies an access token', () => {
    const token = signAccessToken({ sub: 'user-123', roles: ['CUSTOMER'] }, secret, 900);
    const payload = verifyAccessToken(token, secret);

    assert.equal(payload.sub, 'user-123');
    assert.deepEqual(payload.roles, ['CUSTOMER']);
    assert.ok(payload.exp > payload.iat);
  });

  it('rejects tampered and expired access tokens', () => {
    const token = signAccessToken({ sub: 'user-123' }, secret, 900);
    const [header, body, signature] = token.split('.');

    assert.throws(() => verifyAccessToken(`${header}.${body}x.${signature}`, secret));
    assert.throws(() => verifyAccessToken(signAccessToken({ sub: 'user-123' }, secret, -1), secret));
  });

  it('does not turn malformed cookie encoding into a server error', () => {
    const cookies = parseCookies({ get: () => 'refreshToken=%E0%A4%A; theme=dark' });

    assert.equal(cookies.refreshToken, '');
    assert.equal(cookies.theme, 'dark');
  });
});
