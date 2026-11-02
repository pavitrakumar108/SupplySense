export function parseCookies(request) {
  const header = request.get('cookie') ?? '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        if (separator === -1) return [part, ''];
        const value = part.slice(separator + 1);
        try {
          return [part.slice(0, separator), decodeURIComponent(value)];
        } catch {
          return [part.slice(0, separator), ''];
        }
      }),
  );
}

export function setRefreshCookie(response, token, { maxAge }) {
  const attributes = [
    `refreshToken=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/api/v1/auth',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAge / 1000)}`,
  ];
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  response.setHeader('Set-Cookie', attributes.join('; '));
}

export function clearRefreshCookie(response) {
  response.setHeader(
    'Set-Cookie',
    'refreshToken=; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=0',
  );
}
