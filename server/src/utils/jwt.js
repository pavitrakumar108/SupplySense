import { createHmac, timingSafeEqual } from 'node:crypto';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

export function signAccessToken(payload, secret, expiresInSeconds) {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = encode({ ...payload, iat: now, exp: now + expiresInSeconds });
  const unsigned = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function verifyAccessToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token.');

  const [header, body, signature] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new Error('Invalid token.');
  }

  const decodedHeader = decode(header);
  const payload = decode(body);
  if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') throw new Error('Invalid token.');
  if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token.');
  }
  return payload;
}
