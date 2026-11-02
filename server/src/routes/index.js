import { Router } from 'express';
import { createAuthRouter } from './auth.routes.js';
import { createCatalogRouter } from './catalog.routes.js';
import { createCommerceRouter } from './commerce.routes.js';
import { createHealthRouter } from './health.routes.js';
import { createIntelligenceRouter } from './intelligence.routes.js';
import { createDashboardRouter } from './dashboard.routes.js';
import { createOrderRouter } from './order.routes.js';
import { createPaymentRouter } from './payment.routes.js';
import { createSupplyRouter } from './supply.routes.js';
import { createUsersRouter } from './users.routes.js';
import { createWarehouseRouter } from './warehouse.routes.js';

export function createApiRouter({ db }) {
  const router = Router();
  router.use('/health', createHealthRouter({ db }));
  router.use('/auth', createAuthRouter({ db }));
  router.use('/users', createUsersRouter({ db }));
  router.use('/', createCatalogRouter({ db }));
  router.use('/', createCommerceRouter({ db }));
  router.use('/', createOrderRouter({ db }));
  router.use('/payments', createPaymentRouter({ db }));
  router.use('/', createSupplyRouter({ db }));
  router.use('/', createIntelligenceRouter({ db }));
  router.use('/', createDashboardRouter({ db }));
  router.use('/warehouses', createWarehouseRouter({ db }));
  return router;
}
