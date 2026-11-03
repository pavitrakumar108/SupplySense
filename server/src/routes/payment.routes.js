import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeAudit } from '../services/audit.service.js';
import { executeIdempotent, getIdempotencyKey } from '../services/idempotency.service.js';
import { findOrderForUser } from '../services/order.service.js';
import { captureCardPayment, createOrConfirmPayment, processMockWebhook, processQrScan, refundPayment, responseData, verifyMockWebhook } from '../services/payment.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { successResponse } from '../utils/response.js';

const uuid = z.string().uuid();
const paymentParams = z.object({ params: z.object({ orderId: uuid }) });
const confirmRequest = z.object({
  params: z.object({ orderId: uuid }),
  body: z.object({ outcome: z.enum(['success', 'failure', 'pending']).default('success'), providerPaymentId: z.string().trim().max(160).optional() }),
});
const refundRequest = z.object({ params: z.object({ orderId: uuid }), body: z.object({}) .optional() });
const webhookRequest = z.object({ body: z.object({ providerPaymentId: z.string().trim().min(1).max(160), orderId: uuid.optional(), status: z.enum(['CAPTURED', 'FAILED']) }) });
const scanRequest = z.object({
  params: z.object({ orderId: uuid, token: z.string().trim().min(8).max(160) }),
});
const cardRequest = z.object({ params: z.object({ orderId: uuid }), body: z.object({}).optional() });

function sendIdempotent(request, response, result) {
  return successResponse(request, response, result.data, result.statusCode);
}

export function createPaymentRouter({ db }) {
  const router = Router();
  const customerOrAdmin = [authenticate({ db }), requireRoles({ db, roles: ['CUSTOMER', 'ADMIN'] })];
  const managerOrAdmin = [authenticate({ db }), requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN'] })];

  router.post('/webhook', validate(webhookRequest), asyncHandler(async (request, response) => {
    if (!verifyMockWebhook(request.validated.body, request.get('x-provider-signature'))) throw new AppError('Invalid provider signature.', { statusCode: 401, code: 'INVALID_PROVIDER_SIGNATURE' });
    const data = await processMockWebhook(db, { payload: request.validated.body });
    await writeAudit(db, { action: 'PAYMENT_WEBHOOK_PROCESSED', resourceType: 'PAYMENT', metadata: { providerPaymentId: request.validated.body.providerPaymentId, status: request.validated.body.status }, correlationId: request.id });
    return successResponse(request, response, data);
  }));

  router.get('/scan/:orderId/:token', validate(scanRequest), asyncHandler(async (request, response) => {
    const { orderId, token } = request.validated.params;
    const accept = request.get('accept') || '';
    try {
      const result = await processQrScan(db, { orderId, scanToken: token });
      await writeAudit(db, { action: 'PAYMENT_CONFIRMED_VIA_QR_SCAN', resourceType: 'ORDER', resourceId: orderId, correlationId: request.id, metadata: { provider: 'mock_upi_qr', alreadyPaid: result.alreadyPaid } });

      if (accept.includes('text/html')) {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SupplySense - Payment Successful</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0fdf4; color: #14532d; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; box-sizing: border-box; }
    .card { background: #fff; border: 1px solid #bbf7d0; border-radius: 1.25rem; box-shadow: 0 10px 25px -5px rgba(20, 83, 45, 0.1); padding: 2.5rem 2rem; max-width: 440px; width: 100%; text-align: center; }
    .icon { width: 72px; height: 72px; background: #dcfce7; color: #16a34a; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 2.2rem; margin: 0 auto 1.25rem; font-weight: bold; }
    h1 { font-size: 1.6rem; margin: 0 0 .5rem; color: #14532d; }
    p { color: #4b6354; font-size: 0.95rem; line-height: 1.5; margin: 0 0 1.25rem; }
    .badge { background: #f0fdf4; border: 1px dashed #86efac; border-radius: 0.75rem; padding: 0.85rem; font-size: 0.9rem; font-weight: 600; color: #15803d; margin-bottom: 1.5rem; }
    .details { text-align: left; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: .75rem; padding: 1rem; margin-bottom: 1.5rem; font-size: .88rem; }
    .details div { display: flex; justify-content: space-between; margin-bottom: .5rem; color: #334155; }
    .details div:last-child { margin-bottom: 0; font-weight: 700; color: #0f172a; border-top: 1px solid #cbd5e1; padding-top: .5rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Payment Successful!</h1>
    <p>Your payment via QR scan has been verified and captured.</p>
    <div class="details">
      <div><span>Order ID</span><span>#${result.order.id.slice(0, 8)}</span></div>
      <div><span>Status</span><span style="color: #16a34a; font-weight: 700;">${result.order.status}</span></div>
      <div><span>Total Amount</span><span>$${Number(result.order.totalAmount).toFixed(2)}</span></div>
    </div>
    <div class="badge">📡 Scan verified! Your desktop screen is updating automatically.</div>
    <p style="font-size: 0.82rem; color: #64748b; margin-bottom: 0;">You may safely close this mobile browser tab.</p>
  </div>
</body>
</html>`;
        return response.type('html').send(html);
      }
      return successResponse(request, response, responseData(result.order, result.payment));
    } catch (err) {
      if (accept.includes('text/html')) {
        const errorHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SupplySense - Payment Status</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fef2f2; color: #991b1b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; box-sizing: border-box; }
    .card { background: #fff; border: 1px solid #fecaca; border-radius: 1.25rem; box-shadow: 0 10px 25px -5px rgba(153, 27, 27, 0.1); padding: 2.5rem 2rem; max-width: 440px; width: 100%; text-align: center; }
    .icon { width: 72px; height: 72px; background: #fee2e2; color: #dc2626; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 2.2rem; margin: 0 auto 1.25rem; font-weight: bold; }
    h1 { font-size: 1.5rem; margin: 0 0 .5rem; color: #991b1b; }
    p { color: #7f1d1d; font-size: 0.95rem; line-height: 1.5; margin: 0 0 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✕</div>
    <h1>Payment Notice</h1>
    <p>${err.message || 'Unable to complete QR payment.'}</p>
    <p style="font-size: 0.85rem; color: #6b7280;">Please return to your checkout screen.</p>
  </div>
</body>
</html>`;
        return response.status(err.statusCode || 400).type('html').send(errorHtml);
      }
      throw err;
    }
  }));

  router.post('/scan/:orderId/:token', validate(scanRequest), asyncHandler(async (request, response) => {
    const { orderId, token } = request.validated.params;
    const result = await processQrScan(db, { orderId, scanToken: token });
    await writeAudit(db, { action: 'PAYMENT_CONFIRMED_VIA_QR_SCAN', resourceType: 'ORDER', resourceId: orderId, correlationId: request.id, metadata: { provider: 'mock_upi_qr', alreadyPaid: result.alreadyPaid } });
    return successResponse(request, response, responseData(result.order, result.payment));
  }));

  router.post('/:orderId/card', ...customerOrAdmin, validate(cardRequest), asyncHandler(async (request, response) => {
    const { orderId } = request.validated.params;
    const visibleOrder = await findOrderForUser(db, request.user, orderId);
    if (!visibleOrder) throw new AppError('Order not found.', { statusCode: 404, code: 'NOT_FOUND' });
    const key = getIdempotencyKey(request);
    const result = await executeIdempotent({
      db,
      userId: request.user.id,
      key,
      operation: 'PAYMENT_CARD',
      payload: request.validated.body ?? {},
      handler: async (tx) => {
        const paymentResult = await captureCardPayment(tx, { user: request.user, orderId, actorId: request.user.id });
        return { statusCode: paymentResult.statusCode ?? 200, data: responseData(paymentResult.order, paymentResult.payment) };
      },
    });
    if (!result.replayed) await writeAudit(db, { actorId: request.user.id, action: 'PAYMENT_CARD_CAPTURED', resourceType: 'ORDER', resourceId: orderId, correlationId: request.id });
    return sendIdempotent(request, response, result);
  }));

  router.post('/:orderId/confirm', ...customerOrAdmin, validate(confirmRequest), asyncHandler(async (request, response) => {
    const { orderId } = request.validated.params;
    const visibleOrder = await findOrderForUser(db, request.user, orderId);
    if (!visibleOrder) throw new AppError('Order not found.', { statusCode: 404, code: 'NOT_FOUND' });
    if (request.validated.body.outcome === 'success') {
      throw new AppError('Payment confirmation must be received from the payment provider webhook.', { statusCode: 409, code: 'PAYMENT_PROVIDER_CONFIRMATION_REQUIRED' });
    }
    const key = getIdempotencyKey(request);
    const result = await executeIdempotent({
      db,
      userId: request.user.id,
      key,
      operation: 'PAYMENT_CONFIRM',
      payload: request.validated.body,
      handler: async (tx) => {
        const paymentResult = await createOrConfirmPayment(tx, { user: request.user, orderId, actorId: request.user.id, outcome: request.validated.body.outcome, providerPaymentId: request.validated.body.providerPaymentId, idempotencyKey: key });
        return { statusCode: paymentResult.statusCode, data: responseData(paymentResult.order, paymentResult.payment) };
      },
    });
    if (!result.replayed) await writeAudit(db, { actorId: request.user.id, action: 'PAYMENT_CONFIRMED', resourceType: 'ORDER', resourceId: orderId, correlationId: request.id, metadata: { provider: 'mock', outcome: request.validated.body.outcome } });
    return sendIdempotent(request, response, result);
  }));

  router.post('/:orderId/refund', ...managerOrAdmin, validate(refundRequest), asyncHandler(async (request, response) => {
    const { orderId } = request.validated.params;
    const key = getIdempotencyKey(request);
    const result = await executeIdempotent({
      db,
      userId: request.user.id,
      key,
      operation: 'PAYMENT_REFUND',
      payload: request.validated.body ?? {},
      handler: async (tx) => {
        const paymentResult = await refundPayment(tx, { user: request.user, orderId, actorId: request.user.id });
        return { statusCode: paymentResult.statusCode, data: responseData(paymentResult.order, paymentResult.payment) };
      },
    });
    if (!result.replayed) await writeAudit(db, { actorId: request.user.id, action: 'PAYMENT_REFUNDED', resourceType: 'ORDER', resourceId: orderId, correlationId: request.id, metadata: { provider: 'mock' } });
    return sendIdempotent(request, response, result);
  }));

  return router;
}
