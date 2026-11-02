import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { writeAudit } from './audit.service.js';
import { AppError } from '../utils/app-error.js';
import { centsToDecimal, decimalToCents } from '../utils/money.js';

const orderInclude = {
  customer: { select: { id: true, email: true, fullName: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  items: { orderBy: { id: 'asc' }, include: { variant: { select: { attributes: true } } } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  reservations: {
    orderBy: { createdAt: 'asc' },
    include: { items: true },
  },
  payments: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      provider: true,
      providerPaymentId: true,
      amount: true,
      currency: true,
      createdAt: true,
      updatedAt: true,
    },
  },
};

const cartForCheckoutInclude = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      variant: {
        include: {
          product: { select: { id: true, name: true, isActive: true } },
        },
      },
    },
  },
};

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

export function serializeOrder(order) {
  return {
    id: order.id,
    customer: order.customer,
    warehouse: order.warehouse,
    status: order.status,
    paymentMethod: order.paymentMethod ?? 'UPI',
    currency: order.currency,
    subtotalAmount: order.subtotalAmount.toString(),
    discountAmount: order.discountAmount?.toString() ?? '0.00',
    shippingAmount: order.shippingAmount.toString(),
    taxAmount: order.taxAmount.toString(),
    totalAmount: order.totalAmount.toString(),
    shippingAddress: order.shippingAddress,
    items: order.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      sku: item.skuSnapshot,
      productName: item.productNameSnapshot,
      option: item.variant?.attributes?.option ?? '',
      unitPrice: item.unitPrice.toString(),
      quantity: item.quantity,
      lineTotal: item.lineTotal.toString(),
    })),
    statusHistory: order.statusHistory.map((entry) => ({
      id: entry.id,
      status: entry.status,
      note: entry.note,
      createdAt: iso(entry.createdAt),
    })),
    reservations: order.reservations.map((reservation) => ({
      id: reservation.id,
      status: reservation.status,
      expiresAt: iso(reservation.expiresAt),
      confirmedAt: iso(reservation.confirmedAt),
      releasedAt: iso(reservation.releasedAt),
      items: reservation.items.map((item) => ({
        id: item.id,
        inventoryId: item.inventoryId,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      status: payment.status,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      amount: payment.amount.toString(),
      currency: payment.currency,
      createdAt: iso(payment.createdAt),
      updatedAt: iso(payment.updatedAt),
    })),
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
  };
}

export function orderAccessWhere(user, orderId) {
  if (user.roleCodes.includes('ADMIN') || user.roleCodes.includes('AUDITOR')) return { id: orderId };
  if (user.roleCodes.includes('CUSTOMER')) return { id: orderId, customerId: user.id };
  if (user.roleCodes.includes('WAREHOUSE_MANAGER')) {
    return { id: orderId, warehouse: { managers: { some: { managerId: user.id } } } };
  }
  return { id: orderId, customerId: '__no_access__' };
}

function orderListWhere(user) {
  if (user.roleCodes.includes('ADMIN') || user.roleCodes.includes('AUDITOR')) return {};
  if (user.roleCodes.includes('CUSTOMER')) return { customerId: user.id };
  if (user.roleCodes.includes('WAREHOUSE_MANAGER')) return { warehouse: { managers: { some: { managerId: user.id } } } };
  return { customerId: '__no_access__' };
}

export async function findOrderForUser(db, user, orderId) {
  return db.order.findFirst({ where: orderAccessWhere(user, orderId), include: orderInclude });
}

export async function listOrders(db, user, { skip, take, status }) {
  const where = {
    ...orderListWhere(user),
    ...(status ? { status } : {}),
  };
  const [orders, totalItems] = await db.$transaction([
    db.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip, take }),
    db.order.count({ where }),
  ]);
  return { orders, totalItems };
}

function requireCustomerCart(cart) {
  if (!cart?.items?.length) throw new AppError('Your cart is empty.', { statusCode: 422, code: 'EMPTY_CART' });
  for (const item of cart.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
      throw new AppError('Cart quantities must be between 1 and 1000.', { statusCode: 422, code: 'INVALID_CART_QUANTITY' });
    }
    if (!item.variant.isActive || !item.variant.product.isActive) {
      throw new AppError(`SKU ${item.variant.sku} is no longer available.`, { statusCode: 409, code: 'SKU_UNAVAILABLE' });
    }
  }
}

export async function lockInventory(tx, inventoryId) {
  await tx.$queryRaw`SELECT id FROM "Inventory" WHERE id = ${inventoryId}::uuid FOR UPDATE`;
  return tx.inventory.findUnique({ where: { id: inventoryId } });
}

export async function createCheckout(tx, userId, shippingAddress, paymentMethod = 'UPI') {
  const cart = await tx.cart.findUnique({ where: { userId }, include: cartForCheckoutInclude });
  requireCustomerCart(cart);

  const currencies = new Set(cart.items.map((item) => item.variant.currency));
  if (currencies.size !== 1) throw new AppError('All items in an order must use the same currency.', { statusCode: 422, code: 'MIXED_CURRENCIES' });
  const currency = [...currencies][0];
  const lines = cart.items.map((item) => ({
    variantId: item.variantId,
    sku: item.variant.sku,
    productName: item.variant.product.name,
    unitPrice: item.variant.price.toString(),
    quantity: item.quantity,
    unitPriceCents: decimalToCents(item.variant.price),
  }));
  const subtotalCents = lines.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n);
  const warehouses = await tx.warehouse.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { id: 'asc' } });
  if (!warehouses.length) throw new AppError('No active warehouse is available.', { statusCode: 409, code: 'NO_WAREHOUSE_AVAILABLE' });

  const variantIds = [...new Set(lines.map((line) => line.variantId))].sort();
  for (const warehouse of warehouses) {
    for (const variantId of variantIds) {
      await tx.$queryRaw`SELECT id FROM "Inventory" WHERE "warehouse_id" = ${warehouse.id}::uuid AND "variant_id" = ${variantId}::uuid FOR UPDATE`;
    }
  }
  const inventoryRows = await tx.inventory.findMany({ where: { warehouseId: { in: warehouses.map(({ id }) => id) }, variantId: { in: variantIds } } });
  const byWarehouseAndVariant = new Map(inventoryRows.map((row) => [`${row.warehouseId}:${row.variantId}`, row]));
  const eligible = warehouses.map((warehouse) => {
    const availability = lines.map((line) => {
      const inventory = byWarehouseAndVariant.get(`${warehouse.id}:${line.variantId}`);
      return inventory ? inventory.onHandQuantity - inventory.reservedQuantity : 0;
    });
    return { warehouse, availability, eligible: lines.every((line, index) => availability[index] >= line.quantity), score: Math.min(...availability) };
  }).filter(({ eligible: isEligible }) => isEligible).sort((left, right) => right.score - left.score || left.warehouse.id.localeCompare(right.warehouse.id));
  const selected = eligible[0];
  if (!selected) throw new AppError('Insufficient available stock for this order.', { statusCode: 409, code: 'INSUFFICIENT_STOCK' });

  const discountCents = paymentMethod === 'CARD' ? (subtotalCents * 10n + 50n) / 100n : 0n;
  const cappedDiscountCents = discountCents > 50000n ? 50000n : discountCents;
  const subtotal = centsToDecimal(subtotalCents);
  const discount = centsToDecimal(cappedDiscountCents);
  const total = centsToDecimal(subtotalCents - cappedDiscountCents);
  const order = await tx.order.create({
    data: {
      customerId: userId,
      warehouseId: selected.warehouse.id,
      status: 'PENDING_PAYMENT',
      paymentMethod,
      currency,
      subtotalAmount: subtotal,
      discountAmount: discount,
      shippingAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: total,
      shippingAddress,
      items: { create: lines.map((line) => ({ variantId: line.variantId, skuSnapshot: line.sku, productNameSnapshot: line.productName, unitPrice: line.unitPrice, quantity: line.quantity, lineTotal: centsToDecimal(line.unitPriceCents * BigInt(line.quantity)) })) },
      statusHistory: { create: { status: 'PENDING_PAYMENT', note: 'Checkout created.' } },
    },
  });
  const reservation = await tx.reservation.create({
    data: {
      orderId: order.id,
      expiresAt: new Date(Date.now() + env.RESERVATION_TTL_SECONDS * 1000),
      items: { create: lines.map((line) => ({ inventoryId: byWarehouseAndVariant.get(`${selected.warehouse.id}:${line.variantId}`).id, variantId: line.variantId, quantity: line.quantity })) },
    },
  });

  for (const line of lines) {
    const current = byWarehouseAndVariant.get(`${selected.warehouse.id}:${line.variantId}`);
    const updated = await tx.inventory.update({ where: { id: current.id }, data: { reservedQuantity: { increment: line.quantity } } });
    await tx.inventoryMovement.create({
      data: {
        inventoryId: current.id,
        warehouseId: selected.warehouse.id,
        variantId: line.variantId,
        type: 'RESERVATION',
        quantity: line.quantity,
        onHandBefore: current.onHandQuantity,
        onHandAfter: current.onHandQuantity,
        reservedBefore: current.reservedQuantity,
        reservedAfter: updated.reservedQuantity,
        referenceType: 'ORDER_RESERVATION',
        referenceId: order.id,
        actorId: userId,
        metadata: { reservationId: reservation.id },
      },
    });
  }
  if (paymentMethod === 'COD') {
    for (const line of lines) {
      const reference = byWarehouseAndVariant.get(`${selected.warehouse.id}:${line.variantId}`);
      const current = await tx.inventory.findUnique({ where: { id: reference.id } });
      if (!current || current.onHandQuantity < line.quantity || current.reservedQuantity < line.quantity) {
        throw new AppError('Reserved stock is no longer available.', { statusCode: 409, code: 'RESERVATION_INVARIANT_VIOLATION' });
      }
      const updated = await tx.inventory.update({ where: { id: current.id }, data: { onHandQuantity: { decrement: line.quantity }, reservedQuantity: { decrement: line.quantity } } });
      await tx.inventoryMovement.create({ data: {
        inventoryId: current.id,
        warehouseId: selected.warehouse.id,
        variantId: line.variantId,
        type: 'SALE',
        quantity: line.quantity,
        onHandBefore: current.onHandQuantity,
        onHandAfter: updated.onHandQuantity,
        reservedBefore: current.reservedQuantity,
        reservedAfter: updated.reservedQuantity,
        referenceType: 'ORDER_COD',
        referenceId: order.id,
        actorId: userId,
        metadata: { reservationId: reservation.id, paymentMethod: 'COD', paymentDueOnDelivery: true },
      } });
    }
    await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    await tx.payment.create({ data: {
      orderId: order.id,
      provider: 'cash_on_delivery',
      providerPaymentId: `cod_${randomUUID()}`,
      amount: total,
      currency,
      status: 'PENDING',
    } });
    await tx.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED', statusHistory: { create: { status: 'CONFIRMED', note: 'Cash on delivery selected; amount is due on delivery.' } } } });
  }
  await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
  return tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
}

export async function cancelOrder(db, { user, orderId, reason, correlationId }) {
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findFirst({ where: orderAccessWhere(user, orderId), include: orderInclude });
    if (!order) throw new AppError('Order not found.', { statusCode: 404, code: 'NOT_FOUND' });
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') return order;
    if (['SHIPPED', 'DELIVERED'].includes(order.status)) throw new AppError('This order can no longer be cancelled.', { statusCode: 409, code: 'ORDER_NOT_CANCELLABLE' });

    const pendingReservation = order.reservations.find((reservation) => reservation.status === 'PENDING');
    const confirmedReservation = order.reservations.find((reservation) => reservation.status === 'CONFIRMED');
    if (pendingReservation) {
      for (const item of [...pendingReservation.items].sort((left, right) => left.inventoryId.localeCompare(right.inventoryId))) {
        const current = await lockInventory(tx, item.inventoryId);
        if (!current || current.reservedQuantity < item.quantity) throw new AppError('Reservation state is inconsistent.', { statusCode: 409, code: 'RESERVATION_INVARIANT_VIOLATION' });
        const updated = await tx.inventory.update({ where: { id: current.id }, data: { reservedQuantity: { decrement: item.quantity } } });
        await tx.inventoryMovement.create({ data: { inventoryId: current.id, warehouseId: current.warehouseId, variantId: item.variantId, type: 'RELEASE', quantity: item.quantity, onHandBefore: current.onHandQuantity, onHandAfter: current.onHandQuantity, reservedBefore: current.reservedQuantity, reservedAfter: updated.reservedQuantity, referenceType: 'ORDER_CANCELLATION', referenceId: order.id, actorId: user.id, metadata: { reservationId: pendingReservation.id, reason } } });
      }
      await tx.reservation.update({ where: { id: pendingReservation.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
    } else if (confirmedReservation) {
      for (const item of [...confirmedReservation.items].sort((left, right) => left.inventoryId.localeCompare(right.inventoryId))) {
        const current = await lockInventory(tx, item.inventoryId);
        if (!current) throw new AppError('Reservation inventory is missing.', { statusCode: 409, code: 'RESERVATION_INVARIANT_VIOLATION' });
        const updated = await tx.inventory.update({ where: { id: current.id }, data: { onHandQuantity: { increment: item.quantity } } });
        await tx.inventoryMovement.create({ data: { inventoryId: current.id, warehouseId: current.warehouseId, variantId: item.variantId, type: 'RETURN', quantity: item.quantity, onHandBefore: current.onHandQuantity, onHandAfter: updated.onHandQuantity, reservedBefore: current.reservedQuantity, reservedAfter: current.reservedQuantity, referenceType: 'ORDER_CANCELLATION', referenceId: order.id, actorId: user.id, metadata: { reservationId: confirmedReservation.id, reason } } });
      }
    }
    if (order.paymentMethod === 'COD') {
      await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'FAILED' } });
    }
    await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', statusHistory: { create: { status: 'CANCELLED', note: reason ?? 'Order cancelled.' } } } });
    return tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
  });
  await writeAudit(db, { actorId: user.id, action: 'ORDER_CANCELLED', resourceType: 'ORDER', resourceId: result.id, correlationId, metadata: { reason } });
  return result;
}

export { orderInclude };
