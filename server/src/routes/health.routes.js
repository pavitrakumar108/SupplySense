import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';

export function createHealthRouter({ db }) {
  const router = Router();

  router.get('/live', (request, response) => {
    response.json({
      success: true,
      data: { status: 'ok', service: 'supplysense-api' },
      meta: { requestId: request.id },
    });
  });

  router.get('/ready', asyncHandler(async (request, response) => {
    await db.$queryRaw`SELECT 1`;
    response.json({
      success: true,
      data: { status: 'ready', dependencies: { postgres: 'up' } },
      meta: { requestId: request.id },
    });
  }));

  router.get('/', asyncHandler(async (request, response) => {
    let postgres = 'up';

    try {
      await db.$queryRaw`SELECT 1`;
    } catch (error) {
      postgres = 'down';
      request.log?.warn({ err: error, requestId: request.id }, 'postgres health check failed');
    }

    const isHealthy = postgres === 'up';
    response.status(isHealthy ? 200 : 503).json({
      success: isHealthy,
      data: {
        status: isHealthy ? 'ok' : 'degraded',
        service: 'supplysense-api',
        dependencies: { postgres },
      },
      meta: { requestId: request.id },
    });
  }));

  return router;
}
