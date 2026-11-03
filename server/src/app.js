import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestId } from './middleware/request-id.js';
import { createApiRouter } from './routes/index.js';

const clientBuildDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

function allowedOrigins() {
  return [...env.CLIENT_URL.split(','), process.env.RENDER_EXTERNAL_URL ?? '']
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createApp({ db } = {}) {
  const app = express();
  const origins = allowedOrigins();

  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

  app.use(requestId);
  app.use(pinoHttp({ logger }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", 'data:', 'https://rukminim2.flixcart.com', 'https://m.media-amazon.com', 'https://assets.myntassets.com', 'https://images-static.nykaa.com'],
      },
    },
  }));
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS.'));
    },
  }));
  app.use(rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Catalog browsing generates a request for every page/filter change. Keep
    // public reads available even when a customer browses quickly; writes and
    // account/manager endpoints remain protected by the normal limit.
    skip: (request) => request.path.startsWith('/api/v1/health')
      || (request.method === 'GET' && /^\/api\/v1\/(?:products(?:\/[^/]+)?|categories)\/?$/.test(request.path)),
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.get('/', (request, response) => {
    if (env.NODE_ENV === 'production') {
      return response.sendFile(path.join(clientBuildDirectory, 'index.html'));
    }
    response.json({
      success: true,
      data: {
        name: 'SupplySence API',
        version: '0.1.0',
        phase: '13 - release',
      },
      meta: { requestId: request.id },
    });
  });

  app.use('/api/v1', createApiRouter({ db }));

  if (env.NODE_ENV === 'production') {
    app.use(express.static(clientBuildDirectory));
    app.get(/.*/, (request, response, next) => {
      if (!request.accepts('html')) return next();
      response.sendFile(path.join(clientBuildDirectory, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
