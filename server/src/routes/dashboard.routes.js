import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getAdminDashboard, getManagerDashboard, getSupplierDashboard } from '../services/dashboard.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import { successResponse } from '../utils/response.js';

const uuid = z.string().uuid();
const dashboardQuery = z.object({ warehouseId: uuid.optional(), supplierId: uuid.optional(), fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export function createDashboardRouter({ db }) {
  const router = Router();
  const authenticated = authenticate({ db });
  router.get('/dashboards/manager', authenticated, requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN', 'AUDITOR'] }), validate(z.object({ query: dashboardQuery })), asyncHandler(async (request, response) => successResponse(request, response, await getManagerDashboard(db, { user: request.user, ...request.validated.query }))));
  router.get('/dashboards/admin', authenticated, requireRoles({ db, roles: ['ADMIN', 'AUDITOR'] }), validate(z.object({ query: dashboardQuery })), asyncHandler(async (request, response) => successResponse(request, response, await getAdminDashboard(db, request.validated.query))));
  router.get('/dashboards/supplier', authenticated, requireRoles({ db, roles: ['SUPPLIER', 'ADMIN'] }), validate(z.object({ query: dashboardQuery })), asyncHandler(async (request, response) => successResponse(request, response, await getSupplierDashboard(db, { user: request.user, supplierId: request.validated.query.supplierId }))));
  return router;
}
