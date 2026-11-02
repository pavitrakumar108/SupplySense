import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeAudit } from '../services/audit.service.js';
import { createCheckout, findOrderForUser, listOrders, serializeOrder, cancelOrder } from '../services/order.service.js';
import { executeIdempotent, getIdempotencyKey } from '../services/idempotency.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getPagination } from '../utils/pagination.js';
import { createdResponse, paginatedResponse, successResponse } from '../utils/response.js';

const uuid = z.string().uuid();
const address = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  recipientName: z.string().trim().min(2).max(160),
  line1: z.string().trim().min(1).max(240),
  line2: z.string().trim().max(240).optional().nullable(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().min(1).max(30),
  country: z.string().trim().min(2).max(80),
  gstin: z.string().trim().toUpperCase().max(15).regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
});
const checkoutRequest = z.object({ body: z.object({ shippingAddress: address, paymentMethod: z.enum(['UPI', 'CARD', 'COD']).default('UPI') }) });
const orderParams = z.object({ params: z.object({ orderId: uuid }) });
const listOrderRequest = z.object({ query: z.object({ page: z.string().optional(), pageSize: z.string().optional(), status: z.enum(['PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED']).optional() }) });
const cancelRequest = z.object({ params: z.object({ orderId: uuid }), body: z.object({ reason: z.string().trim().max(240).optional() }).optional() });

export function createOrderRouter({ db }) {
  const router = Router();
  const customer = [authenticate({ db }), requireRoles({ db, roles: ['CUSTOMER'] })];
  const orderReaders = [authenticate({ db }), requireRoles({ db, roles: ['CUSTOMER', 'WAREHOUSE_MANAGER', 'ADMIN', 'AUDITOR'] })];
  const cancelActors = [authenticate({ db }), requireRoles({ db, roles: ['CUSTOMER', 'WAREHOUSE_MANAGER', 'ADMIN'] })];

  router.post('/checkout', ...customer, validate(checkoutRequest), asyncHandler(async (request, response) => {
    const key = getIdempotencyKey(request);
    const result = await executeIdempotent({
      db,
      userId: request.user.id,
      key,
      operation: 'CHECKOUT',
      payload: request.validated.body,
      handler: async (tx) => ({ statusCode: 201, data: serializeOrder(await createCheckout(tx, request.user.id, request.validated.body.shippingAddress, request.validated.body.paymentMethod)) }),
    });
    if (!result.replayed) await writeAudit(db, { actorId: request.user.id, action: 'CHECKOUT_CREATED', resourceType: 'ORDER', resourceId: result.data.id, correlationId: request.id });
    return createdResponse(request, response, result.data);
  }));

  router.get('/orders', ...orderReaders, validate(listOrderRequest), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { orders, totalItems } = await listOrders(db, request.user, { skip, take, status: request.validated.query.status });
    return paginatedResponse(request, response, orders.map(serializeOrder), { page, pageSize, totalItems });
  }));

  router.get('/orders/:orderId', ...orderReaders, validate(orderParams), asyncHandler(async (request, response) => {
    const order = await findOrderForUser(db, request.user, request.validated.params.orderId);
    if (!order) throw new AppError('Order not found.', { statusCode: 404, code: 'NOT_FOUND' });
    return successResponse(request, response, serializeOrder(order));
  }));

  router.post('/orders/:orderId/cancel', ...cancelActors, validate(cancelRequest), asyncHandler(async (request, response) => {
    const order = await cancelOrder(db, { user: request.user, orderId: request.validated.params.orderId, reason: request.validated.body?.reason, correlationId: request.id });
    return successResponse(request, response, serializeOrder(order));
  }));

  return router;
}
