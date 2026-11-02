import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { orderAccessWhere, orderInclude, serializeOrder, lockInventory } from './order.service.js';
import { AppError } from '../utils/app-error.js';

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

export function serializePayment(payment) {
  return {
    id: payment.id,
    status: payment.status,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    amount: payment.amount.toString(),
    currency: payment.currency,
    createdAt: iso(payment.createdAt),
    updatedAt: iso(payment.updatedAt),
  };
}

function responseData(order, payment) {
  return { order: serializeOrder(order), payment: serializePayment(payment) };
}

async function loadLockedOrder(tx, user, orderId) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
  const order = await tx.order.findFirst({ where: orderAccessWhere(user, orderId), include: orderInclude });
  if (!order) throw new AppError('Order not found.', { statusCode: 404, code: 'NOT_FOUND' });
  return order;
}

async function releasePendingReservation(tx, order, actorId, reason) {
  const reservation = order.reservations.find((item) => item.status === 'PENDING');
  if (!reservation) return;
  for (const item of [...reservation.items].sort((left, right) => left.inventoryId.localeCompare(right.inventoryId))) {
    const current = await lockInventory(tx, item.inventoryId);
    if (!current || current.reservedQuantity < item.quantity) throw new AppError('Reservation state is inconsistent.', { statusCode: 409, code: 'RESERVATION_INVARIANT_VIOLATION' });
    const updated = await tx.inventory.update({ where: { id: current.id }, data: { reservedQuantity: { decrement: item.quantity } } });
    await tx.inventoryMovement.create({ data: { inventoryId: current.id, warehouseId: current.warehouseId, variantId: item.variantId, type: 'RELEASE', quantity: item.quantity, onHandBefore: current.onHandQuantity, onHandAfter: current.onHandQuantity, reservedBefore: current.reservedQuantity, reservedAfter: updated.reservedQuantity, referenceType: 'PAYMENT_FAILURE', referenceId: order.id, actorId, metadata: { reservationId: reservation.id, reason } } });
  }
  await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
}

async function loadPayment(tx, paymentId) {
  return tx.payment.findUnique({ where: { id: paymentId } });
}

export async function capturePendingPayment(tx, { paymentId, actorId }) {
  const payment = await loadPayment(tx, paymentId);
  if (!payment) throw new AppError('Payment not found.', { statusCode: 404, code: 'NOT_FOUND' });
  const order = await loadLockedOrder(tx, { roleCodes: ['ADMIN'] }, payment.orderId);
  if (payment.status === 'CAPTURED') return { order, payment };
  if (payment.status !== 'PENDING') throw new AppError('This payment cannot be captured.', { statusCode: 409, code: 'PAYMENT_STATE_CONFLICT' });
  if (order.status !== 'PENDING_PAYMENT') throw new AppError('This order is not awaiting payment.', { statusCode: 409, code: 'ORDER_STATE_CONFLICT' });

  const reservation = order.reservations.find((item) => item.status === 'PENDING');
  if (!reservation || reservation.expiresAt <= new Date()) {
    await releasePendingReservation(tx, order, actorId, 'Reservation expired before payment confirmation.');
    const failedPayment = await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    const cancelledOrder = await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', statusHistory: { create: { status: 'CANCELLED', note: 'Reservation expired before payment confirmation.' } } }, include: orderInclude });
    return { order: cancelledOrder, payment: failedPayment, statusCode: 200 };
  }

  const sortedItems = [...reservation.items].sort((left, right) => left.inventoryId.localeCompare(right.inventoryId));
  for (const item of sortedItems) {
    const current = await lockInventory(tx, item.inventoryId);
    if (!current || current.reservedQuantity < item.quantity || current.onHandQuantity < item.quantity) throw new AppError('Reserved stock is no longer available.', { statusCode: 409, code: 'RESERVATION_INVARIANT_VIOLATION' });
    const updated = await tx.inventory.update({ where: { id: current.id }, data: { onHandQuantity: { decrement: item.quantity }, reservedQuantity: { decrement: item.quantity } } });
    await tx.inventoryMovement.create({ data: { inventoryId: current.id, warehouseId: current.warehouseId, variantId: item.variantId, type: 'SALE', quantity: item.quantity, onHandBefore: current.onHandQuantity, onHandAfter: updated.onHandQuantity, reservedBefore: current.reservedQuantity, reservedAfter: updated.reservedQuantity, referenceType: 'ORDER_PAYMENT', referenceId: order.id, actorId, metadata: { reservationId: reservation.id, paymentId: payment.id } } });
  }
  const capturedPayment = await tx.payment.update({ where: { id: payment.id }, data: { status: 'CAPTURED' } });
  await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
  await tx.order.update({ where: { id: order.id }, data: { status: 'PAID', statusHistory: { create: { status: 'PAID', note: 'Mock payment captured.' } } } });
  await tx.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED', statusHistory: { create: { status: 'CONFIRMED', note: 'Reservation confirmed and stock committed.' } } } });
  const confirmedOrder = await tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
  return { order: confirmedOrder, payment: capturedPayment, statusCode: 200 };
}

export async function failPendingPayment(tx, { paymentId, actorId, reason = 'Mock payment failed.' }) {
  const payment = await loadPayment(tx, paymentId);
  if (!payment) throw new AppError('Payment not found.', { statusCode: 404, code: 'NOT_FOUND' });
  const order = await loadLockedOrder(tx, { roleCodes: ['ADMIN'] }, payment.orderId);
  if (payment.status === 'FAILED') return { order, payment, statusCode: 200 };
  if (payment.status !== 'PENDING') throw new AppError('This payment cannot fail from its current state.', { statusCode: 409, code: 'PAYMENT_STATE_CONFLICT' });
  await releasePendingReservation(tx, order, actorId, reason);
  const failedPayment = await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
  const cancelledOrder = await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', statusHistory: { create: { status: 'CANCELLED', note: reason } } }, include: orderInclude });
  return { order: cancelledOrder, payment: failedPayment, statusCode: 200 };
}

export async function createOrConfirmPayment(tx, { user, orderId, actorId, outcome, providerPaymentId, idempotencyKey }) {
  const order = await loadLockedOrder(tx, user, orderId);
  if (order.status !== 'PENDING_PAYMENT') throw new AppError('This order is not awaiting payment.', { statusCode: 409, code: 'ORDER_STATE_CONFLICT' });
  const existingPayment = order.payments.find((payment) => payment.providerPaymentId === providerPaymentId);
  if (existingPayment) throw new AppError('This provider payment reference has already been used.', { statusCode: 409, code: 'PAYMENT_REFERENCE_REUSED' });
  const payment = await tx.payment.create({ data: { orderId, provider: 'mock', providerPaymentId: providerPaymentId ?? `mock_${randomUUID()}`, amount: order.totalAmount, currency: order.currency, idempotencyKey, status: 'PENDING' } });
  if (outcome === 'pending') {
    const pendingOrder = await tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
    return { order: pendingOrder, payment, statusCode: 200 };
  }
  if (outcome === 'failure') return failPendingPayment(tx, { paymentId: payment.id, actorId, reason: 'Mock payment declined.' });
  return capturePendingPayment(tx, { paymentId: payment.id, actorId });
}

export async function refundPayment(tx, { user, orderId, actorId }) {
  const order = await loadLockedOrder(tx, user, orderId);
  if (order.status === 'REFUNDED') {
    const payment = order.payments.at(-1);
    return { order, payment, statusCode: 200 };
  }
  if (order.status !== 'CANCELLED') throw new AppError('Only cancelled orders can be refunded.', { statusCode: 409, code: 'ORDER_NOT_REFUNDABLE' });
  const payment = await tx.payment.findFirst({ where: { orderId, status: { in: ['CAPTURED', 'AUTHORIZED'] } }, orderBy: { createdAt: 'desc' } });
  if (!payment) throw new AppError('No captured payment is available for refund.', { statusCode: 409, code: 'PAYMENT_NOT_REFUNDABLE' });
  const refundedPayment = await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
  await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED', statusHistory: { create: { status: 'REFUNDED', note: 'Mock payment refunded.' } } } });
  const refundedOrder = await tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
  return { order: refundedOrder, payment: refundedPayment, statusCode: 200, actorId };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function verifyMockWebhook(payload, signature) {
  if (!signature) return false;
  const expected = createHmac('sha256', env.MOCK_PAYMENT_WEBHOOK_SECRET).update(stableStringify(payload)).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(signature.trim());
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export async function processMockWebhook(db, { payload }) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { providerPaymentId: payload.providerPaymentId } });
    if (!payment) throw new AppError('Payment reference not found.', { statusCode: 404, code: 'NOT_FOUND' });
    if (payload.orderId && payload.orderId !== payment.orderId) throw new AppError('Payment does not belong to this order.', { statusCode: 409, code: 'PAYMENT_ORDER_MISMATCH' });
    const result = payload.status === 'CAPTURED'
      ? await capturePendingPayment(tx, { paymentId: payment.id, actorId: null })
      : await failPendingPayment(tx, { paymentId: payment.id, actorId: null, reason: 'Mock payment declined by provider callback.' });
    return responseData(result.order, result.payment);
  });
}

export async function captureCardPayment(tx, { user, orderId, actorId }) {
  const order = await loadLockedOrder(tx, user, orderId);
  if (order.paymentMethod && order.paymentMethod !== 'CARD') throw new AppError('This order was not placed with card payment.', { statusCode: 409, code: 'PAYMENT_METHOD_MISMATCH' });
  if (order.status === 'PAID' || order.status === 'CONFIRMED') {
    return { order, payment: order.payments.at(-1), statusCode: 200 };
  }
  if (order.status !== 'PENDING_PAYMENT') throw new AppError('This order is not awaiting payment.', { statusCode: 409, code: 'ORDER_STATE_CONFLICT' });
  let payment = order.payments.find((item) => item.status === 'PENDING');
  if (!payment) {
    payment = await tx.payment.create({
      data: {
        orderId,
        provider: 'mock_card',
        providerPaymentId: `card_${randomUUID()}`,
        amount: order.totalAmount,
        currency: order.currency,
        status: 'PENDING',
      },
    });
  }
  return capturePendingPayment(tx, { paymentId: payment.id, actorId });
}

export async function processQrScan(db, { orderId, scanToken }) {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    if (!order) throw new AppError('Order not found.', { statusCode: 404, code: 'NOT_FOUND' });
    if (order.paymentMethod && order.paymentMethod !== 'UPI') throw new AppError('This order was not placed with UPI payment.', { statusCode: 409, code: 'PAYMENT_METHOD_MISMATCH' });
    if (order.status === 'PAID' || order.status === 'CONFIRMED') {
      const payment = order.payments.at(-1);
      return { order, payment, statusCode: 200, alreadyPaid: true, scanned: true };
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw new AppError('This order is not awaiting payment.', { statusCode: 409, code: 'ORDER_STATE_CONFLICT' });
    }

    const payment = order.payments.find((item) => item.status === 'PENDING');
    if (!payment) {
      throw new AppError('No QR payment is waiting for this order.', { statusCode: 409, code: 'QR_NOT_INITIALIZED' });
    }
    if (!scanToken || (payment.providerPaymentId !== scanToken && payment.provider !== 'mock_upi_qr_scanned')) {
      throw new AppError('QR has not been scanned. Open this page from the checkout QR code.', { statusCode: 403, code: 'QR_SCAN_REQUIRED' });
    }

    await tx.payment.update({ where: { id: payment.id }, data: { provider: 'mock_upi_qr_scanned' } });
    const captureResult = await capturePendingPayment(tx, { paymentId: payment.id, actorId: null });
    return { ...captureResult, statusCode: 200, alreadyPaid: false, scanned: true };
  });
}

export { responseData };
