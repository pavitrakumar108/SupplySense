import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';
import { releaseExpiredReservations } from './services/reservation.service.js';

const app = createApp({ db: prisma });
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'SupplySense API started');
});
const reservationExpiryTimer = setInterval(() => {
  releaseExpiredReservations(prisma).catch((error) => logger.error({ err: error }, 'reservation expiry worker failed'));
}, 60000);
reservationExpiryTimer.unref();
releaseExpiredReservations(prisma).catch((error) => logger.error({ err: error }, 'reservation expiry worker failed'));

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'shutdown started');
  clearInterval(reservationExpiryTimer);

  const forceExit = setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async () => {
    await prisma.$disconnect();
    clearTimeout(forceExit);
    logger.info('shutdown complete');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  logger.fatal({ err: error }, 'unhandled promise rejection');
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  shutdown('uncaughtException');
});
