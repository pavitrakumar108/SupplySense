import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeAudit } from '../services/audit.service.js';
import { executeIdempotent, getIdempotencyKey } from '../services/idempotency.service.js';
import { approveRecommendation, getRecommendation, listAnomalies, listForecasts, listRecommendations, listSalesHistory, rejectRecommendation, runIntelligence, serializeAnomaly, serializeForecast, serializeRecommendation } from '../services/intelligence.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getPagination } from '../utils/pagination.js';
import { paginatedResponse, successResponse } from '../utils/response.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.');
const commonQuery = z.object({ page: z.string().optional(), pageSize: z.string().optional(), warehouseId: uuid.optional(), variantId: uuid.optional() });
const runRequest = z.object({ body: z.object({ warehouseId: uuid.optional(), variantIds: z.array(uuid).max(100).optional(), fromDate: date.optional(), toDate: date.optional(), horizonDays: z.number().int().min(1).max(90).default(14) }) });
const salesHistoryRequest = z.object({ query: commonQuery.extend({ fromDate: date.optional(), toDate: date.optional() }) });
const recommendationQuery = commonQuery.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'INSUFFICIENT_HISTORY']).optional(), priority: z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'NONE']).optional() });
const recommendationParams = z.object({ params: z.object({ recommendationId: uuid }) });
const rejectRequest = z.object({ params: z.object({ recommendationId: uuid }), body: z.object({ reason: z.string().trim().max(500).optional() }).optional() });

function sendIdempotent(request, response, result) {
  return successResponse(request, response, result.data, result.statusCode);
}

export function createIntelligenceRouter({ db }) {
  const router = Router();
  const authenticated = authenticate({ db });
  const readers = [authenticated, requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN', 'AUDITOR'] })];
  const decisionMakers = [authenticated, requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN'] })];

  router.post('/intelligence/run', ...readers, validate(runRequest), asyncHandler(async (request, response) => {
    const result = await runIntelligence(db, { user: request.user, ...request.validated.body, correlationId: request.id });
    return successResponse(request, response, result);
  }));

  router.get('/analytics/sales-history', ...readers, validate(salesHistoryRequest), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { rows, totalItems } = await listSalesHistory(db, request.user, { ...request.validated.query, skip, take });
    return paginatedResponse(request, response, rows.map((row) => ({ id: row.id, variantId: row.variantId, warehouseId: row.warehouseId, sku: row.variant.sku, productName: row.variant.product?.name, warehouse: row.warehouse, businessDate: row.businessDate.toISOString().slice(0, 10), unitsSold: row.unitsSold, revenue: row.revenue.toString(), stockoutFlag: row.stockoutFlag })), { page, pageSize, totalItems });
  }));

  for (const [path, loader, serializer] of [['forecasts', listForecasts, serializeForecast], ['anomalies', listAnomalies, serializeAnomaly], ['recommendations', listRecommendations, serializeRecommendation]]) {
    router.get(`/analytics/${path}`, ...readers, validate(z.object({ query: path === 'recommendations' ? recommendationQuery : commonQuery })), asyncHandler(async (request, response) => {
      const { page, pageSize, skip, take } = getPagination(request.validated.query);
      const { rows, totalItems } = await loader(db, request.user, { ...request.validated.query, skip, take });
      return paginatedResponse(request, response, rows.map(serializer), { page, pageSize, totalItems });
    }));
  }

  router.get('/anomalies', ...readers, validate(z.object({ query: commonQuery })), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { rows, totalItems } = await listAnomalies(db, request.user, { ...request.validated.query, skip, take });
    return paginatedResponse(request, response, rows.map(serializeAnomaly), { page, pageSize, totalItems });
  }));

  router.get('/recommendations', ...readers, validate(z.object({ query: recommendationQuery })), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { rows, totalItems } = await listRecommendations(db, request.user, { ...request.validated.query, skip, take });
    return paginatedResponse(request, response, rows.map(serializeRecommendation), { page, pageSize, totalItems });
  }));

  async function recommendationDetail(request, response) {
    const recommendation = await getRecommendation(db, request.user, request.validated.params.recommendationId);
    if (!recommendation) throw new AppError('Recommendation not found.', { statusCode: 404, code: 'NOT_FOUND' });
    return successResponse(request, response, serializeRecommendation(recommendation));
  }
  router.get('/analytics/recommendations/:recommendationId', ...readers, validate(recommendationParams), asyncHandler(recommendationDetail));
  router.get('/recommendations/:recommendationId', ...readers, validate(recommendationParams), asyncHandler(recommendationDetail));

  router.post('/recommendations/:recommendationId/approve', ...decisionMakers, validate(recommendationParams), asyncHandler(async (request, response) => {
    const key = getIdempotencyKey(request);
    const result = await executeIdempotent({
      db,
      userId: request.user.id,
      key,
      operation: 'RECOMMENDATION_APPROVE',
      payload: { recommendationId: request.validated.params.recommendationId },
      handler: async (tx) => ({ statusCode: 200, data: serializeRecommendation(await approveRecommendation(tx, { user: request.user, recommendationId: request.validated.params.recommendationId, correlationId: request.id })) }),
    });
    return sendIdempotent(request, response, result);
  }));

  router.post('/recommendations/:recommendationId/reject', ...decisionMakers, validate(rejectRequest), asyncHandler(async (request, response) => {
    const key = getIdempotencyKey(request);
    const result = await executeIdempotent({
      db,
      userId: request.user.id,
      key,
      operation: 'RECOMMENDATION_REJECT',
      payload: { recommendationId: request.validated.params.recommendationId, reason: request.validated.body?.reason ?? null },
      handler: async (tx) => ({ statusCode: 200, data: serializeRecommendation(await rejectRecommendation(tx, { user: request.user, recommendationId: request.validated.params.recommendationId, reason: request.validated.body?.reason, correlationId: request.id })) }),
    });
    return sendIdempotent(request, response, result);
  }));

  return router;
}
