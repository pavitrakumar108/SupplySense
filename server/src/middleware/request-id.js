import { randomUUID } from 'node:crypto';

const requestIdPattern = /^[A-Za-z0-9_.:-]{1,128}$/;

export function requestId(request, response, next) {
  const incoming = request.get('x-request-id');
  const id = incoming && requestIdPattern.test(incoming) ? incoming : randomUUID();

  request.id = id;
  response.setHeader('x-request-id', id);
  next();
}
