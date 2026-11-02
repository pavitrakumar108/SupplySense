import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';

const servers = new Set();

async function startServer(db) {
  const server = createApp({ db }).listen(0);
  servers.add(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    server,
    request: (path, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, options),
  };
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
  servers.clear();
});

describe('API foundation', () => {
  it('exposes liveness without a database and preserves a valid request ID', async () => {
    const { request } = await startServer({
      $queryRaw: async () => [{ '?column?': 1 }],
    });

    const response = await request('/api/v1/health/live', {
      headers: { 'x-request-id': 'smoke-test-001' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'smoke-test-001');
    assert.deepEqual(body.data, { status: 'ok', service: 'supplysense-api' });
    assert.equal(body.meta.requestId, 'smoke-test-001');
  });

  it('reports readiness only when PostgreSQL responds', async () => {
    const { request } = await startServer({
      $queryRaw: async () => [{ '?column?': 1 }],
    });

    const response = await request('/api/v1/health/ready');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.status, 'ready');
    assert.equal(body.data.dependencies.postgres, 'up');
  });

  it('returns degraded aggregate health when PostgreSQL is unavailable', async () => {
    const { request } = await startServer({
      $queryRaw: async () => {
        throw new Error('database unavailable');
      },
    });

    const response = await request('/api/v1/health');
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.data.status, 'degraded');
    assert.equal(body.data.dependencies.postgres, 'down');
  });

  it('returns a safe, correlated 404 response for unknown routes', async () => {
    const { request } = await startServer({
      $queryRaw: async () => [{ '?column?': 1 }],
    });

    const response = await request('/api/v1/does-not-exist', {
      headers: { 'x-request-id': 'missing-route-001' },
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(body.error.requestId, 'missing-route-001');
    assert.match(body.error.message, /Route GET \/api\/v1\/does-not-exist was not found/);
  });

  it('sets baseline security headers', async () => {
    const { request } = await startServer({
      $queryRaw: async () => [{ '?column?': 1 }],
    });

    const response = await request('/');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
  });
});
