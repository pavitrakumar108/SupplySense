import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/app-error.js';
import { centsToDecimal, decimalToCents } from '../utils/money.js';

const supplierSelect = { id: true, code: true, name: true, email: true, isActive: true, userId: true };
const warehouseSelect = { id: true, code: true, name: true, city: true, state: true, isActive: true };
const userSelect = { id: true, email: true, fullName: true };

const purchaseOrderInclude = {
  supplier: { select: supplierSelect },
  warehouse: { select: warehouseSelect },
  createdBy: { select: userSelect },
  items: {
    orderBy: { id: 'asc' },
    include: {
      variant: { select: { id: true, sku: true, price: true, currency: true, product: { select: { id: true, name: true } } } },
      supplierProduct: { include: { supplier: { select: supplierSelect } } },
      shipmentItems: { orderBy: { id: 'asc' } },
      receiptItems: { orderBy: { id: 'asc' } },
    },
  },
  shipments: { orderBy: { createdAt: 'asc' }, include: { shipmentItems: { orderBy: { id: 'asc' } } } },
  receipts: { orderBy: { receivedAt: 'asc' }, include: { warehouse: { select: warehouseSelect }, receivedBy: { select: userSelect }, items: { orderBy: { id: 'asc' } } } },
};

const shipmentInclude = {
  shipmentItems: { orderBy: { id: 'asc' }, include: { variant: { select: { id: true, sku: true } }, purchaseOrderItem: { select: { id: true, quantityOrdered: true } } } },
  purchaseOrder: { include: { supplier: { select: supplierSelect }, warehouse: { select: warehouseSelect } } },
};

function isAdmin(user) { return user.roleCodes.includes('ADMIN'); }
function isAuditor(user) { return user.roleCodes.includes('AUDITOR'); }
function isManager(user) { return user.roleCodes.includes('WAREHOUSE_MANAGER'); }
function isSupplier(user) { return user.roleCodes.includes('SUPPLIER'); }

export function purchaseOrderWhere(user, purchaseOrderId) {
  const base = purchaseOrderId ? { id: purchaseOrderId } : {};
  if (isAdmin(user) || isAuditor(user)) return base;
  if (isManager(user)) return { ...base, warehouse: { managers: { some: { managerId: user.id } } } };
  if (isSupplier(user)) return { ...base, supplier: { userId: user.id } };
  return { ...base, id: '__no_access__' };
}

export async function assertWarehouseAccess(db, user, warehouseId) {
  const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId, isActive: true }, select: { id: true } });
  if (!warehouse) throw new AppError('Warehouse not found or inactive.', { statusCode: 404, code: 'NOT_FOUND' });
  if (isAdmin(user) || isAuditor(user)) return warehouse;
  if (!isManager(user)) throw new AppError('You are not authorized to access this warehouse.', { statusCode: 403, code: 'FORBIDDEN' });
  const assignment = await db.managerWarehouse.findUnique({ where: { managerId_warehouseId: { managerId: user.id, warehouseId } } });
  if (!assignment) throw new AppError('You are not authorized to access this warehouse.', { statusCode: 403, code: 'FORBIDDEN' });
  return warehouse;
}

export async function visibleWarehouseIds(db, user, warehouseId) {
  if (warehouseId) {
    await assertWarehouseAccess(db, user, warehouseId);
    return [warehouseId];
  }
  if (isAdmin(user) || isAuditor(user)) {
    const warehouses = await db.warehouse.findMany({ where: { isActive: true }, select: { id: true }, orderBy: { code: 'asc' } });
    return warehouses.map(({ id }) => id);
  }
  if (isManager(user)) {
    const assignments = await db.managerWarehouse.findMany({ where: { managerId: user.id, warehouse: { isActive: true } }, select: { warehouseId: true }, orderBy: { warehouseId: 'asc' } });
    return assignments.map(({ warehouseId: id }) => id);
  }
  return [];
}

export function serializeSupplier(supplier) {
  return supplier ? { id: supplier.id, code: supplier.code, name: supplier.name, email: supplier.email, isActive: supplier.isActive } : null;
}

export function serializeWarehouse(warehouse) {
  return warehouse ? { id: warehouse.id, code: warehouse.code, name: warehouse.name, city: warehouse.city, state: warehouse.state, isActive: warehouse.isActive } : null;
}

export function serializeSupplierProduct(product) {
  return {
    id: product.id,
    supplierId: product.supplierId,
    variantId: product.variantId,
    supplierSku: product.supplierSku,
    unitCost: product.unitCost.toString(),
    currency: product.currency,
    leadTimeDays: product.leadTimeDays,
    minimumOrderQty: product.minimumOrderQty,
    packSize: product.packSize,
    isActive: product.isActive,
    supplier: serializeSupplier(product.supplier),
    variant: product.variant ? { id: product.variant.id, sku: product.variant.sku, price: product.variant.price.toString(), productName: product.variant.product?.name } : undefined,
  };
}

export function serializeShipmentItem(item) {
  return {
    id: item.id,
    shipmentId: item.shipmentId,
    purchaseOrderItemId: item.purchaseOrderItemId,
    variantId: item.variantId,
    sku: item.variant?.sku,
    quantityShipped: item.quantityShipped,
  };
}

export function serializeShipment(shipment) {
  return {
    id: shipment.id,
    purchaseOrderId: shipment.purchaseOrderId,
    purchaseOrder: shipment.purchaseOrder ? {
      id: shipment.purchaseOrder.id,
      orderNumber: shipment.purchaseOrder.orderNumber,
      warehouse: serializeWarehouse(shipment.purchaseOrder.warehouse),
      supplier: serializeSupplier(shipment.purchaseOrder.supplier),
    } : undefined,
    status: shipment.status,
    trackingNumber: shipment.trackingNumber,
    shippedAt: shipment.shippedAt?.toISOString() ?? null,
    deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
    createdAt: shipment.createdAt?.toISOString(),
    updatedAt: shipment.updatedAt?.toISOString(),
    items: (shipment.shipmentItems ?? []).map(serializeShipmentItem),
  };
}

export function serializeReceiptItem(item) {
  return {
    id: item.id,
    goodsReceiptId: item.goodsReceiptId,
    purchaseOrderItemId: item.purchaseOrderItemId,
    variantId: item.variantId,
    quantityReceived: item.quantityReceived,
    batchCode: item.batchCode,
    expiryDate: item.expiryDate?.toISOString().slice(0, 10) ?? null,
  };
}

export function serializeGoodsReceipt(receipt) {
  return {
    id: receipt.id,
    purchaseOrderId: receipt.purchaseOrderId,
    warehouse: serializeWarehouse(receipt.warehouse),
    receivedBy: receipt.receivedBy ? { id: receipt.receivedBy.id, email: receipt.receivedBy.email, fullName: receipt.receivedBy.fullName } : null,
    receivedAt: receipt.receivedAt?.toISOString(),
    notes: receipt.notes,
    items: (receipt.items ?? []).map(serializeReceiptItem),
  };
}

export function serializePurchaseOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    totalAmount: order.totalAmount.toString(),
    supplier: serializeSupplier(order.supplier),
    warehouse: serializeWarehouse(order.warehouse),
    createdBy: order.createdBy ? { id: order.createdBy.id, email: order.createdBy.email, fullName: order.createdBy.fullName } : null,
    items: order.items.map((item) => ({
      id: item.id,
      supplierProductId: item.supplierProductId,
      variantId: item.variantId,
      sku: item.variant?.sku,
      productName: item.variant?.product?.name,
      quantityOrdered: item.quantityOrdered,
      quantityReceived: item.quantityReceived,
      quantityShipped: (item.shipmentItems ?? []).reduce((sum, line) => sum + line.quantityShipped, 0),
      outstandingShipmentQuantity: Math.max(0, item.quantityOrdered - (item.shipmentItems ?? []).reduce((sum, line) => sum + line.quantityShipped, 0)),
      outstandingReceiptQuantity: Math.max(0, item.quantityOrdered - item.quantityReceived),
      unitCost: item.unitCost.toString(),
      lineTotal: item.lineTotal.toString(),
      supplierProduct: item.supplierProduct ? serializeSupplierProduct(item.supplierProduct) : undefined,
      shipmentItems: (item.shipmentItems ?? []).map(serializeShipmentItem),
      receiptItems: (item.receiptItems ?? []).map(serializeReceiptItem),
    })),
    shipments: (order.shipments ?? []).map(serializeShipment),
    receipts: (order.receipts ?? []).map(serializeGoodsReceipt),
    createdAt: order.createdAt?.toISOString(),
    updatedAt: order.updatedAt?.toISOString(),
  };
}

export async function listSuppliers(db, user, { skip, take, search }) {
  const where = isSupplier(user)
    ? { userId: user.id }
    : { isActive: true, ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }] } : {}) };
  const [suppliers, totalItems] = await db.$transaction([
    db.supplier.findMany({ where, orderBy: { code: 'asc' }, skip, take, select: supplierSelect }),
    db.supplier.count({ where }),
  ]);
  return { suppliers, totalItems };
}

export async function createSupplier(db, data) {
  return db.supplier.create({ data, select: supplierSelect });
}

export async function updateSupplier(db, supplierId, data) {
  return db.supplier.update({ where: { id: supplierId }, data, select: supplierSelect });
}

export async function listSupplierProducts(db, user, supplierId, { skip, take, variantId }) {
  if (isSupplier(user) && !(await db.supplier.findFirst({ where: { id: supplierId, userId: user.id }, select: { id: true } }))) {
    throw new AppError('Supplier record not found.', { statusCode: 404, code: 'NOT_FOUND' });
  }
  const where = { supplierId, ...(variantId ? { variantId } : {}) };
  const [products, totalItems] = await db.$transaction([
    db.supplierProduct.findMany({ where, include: { supplier: { select: supplierSelect }, variant: { include: { product: { select: { name: true } } } } }, orderBy: { variantId: 'asc' }, skip, take }),
    db.supplierProduct.count({ where }),
  ]);
  return { products, totalItems };
}

export async function createSupplierProduct(db, data) {
  const [supplier, variant] = await Promise.all([
    db.supplier.findUnique({ where: { id: data.supplierId, isActive: true }, select: { id: true } }),
    db.productVariant.findUnique({ where: { id: data.variantId, isActive: true }, select: { id: true } }),
  ]);
  if (!supplier || !variant) throw new AppError('Supplier or SKU is not active.', { statusCode: 422, code: 'INVALID_SUPPLIER_PRODUCT' });
  return db.supplierProduct.create({ data, include: { supplier: { select: supplierSelect }, variant: { include: { product: { select: { name: true } } } } } });
}

export async function updateSupplierProduct(db, supplierProductId, data) {
  return db.supplierProduct.update({ where: { id: supplierProductId }, data, include: { supplier: { select: supplierSelect }, variant: { include: { product: { select: { name: true } } } } } });
}

async function assertManagerWarehouse(tx, user, warehouseId) {
  if (!isManager(user)) return;
  const assignment = await tx.managerWarehouse.findUnique({ where: { managerId_warehouseId: { managerId: user.id, warehouseId } } });
  if (!assignment) throw new AppError('You are not authorized to access this warehouse.', { statusCode: 403, code: 'FORBIDDEN' });
}

function assertUniquePositiveItems(items, field = 'supplierProductId') {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item[field]) || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError('Items must be unique and have positive integer quantities.', { statusCode: 422, code: 'INVALID_ITEMS' });
    }
    seen.add(item[field]);
  }
}

export async function createPurchaseOrder(db, { user, supplierId, warehouseId, items }) {
  assertUniquePositiveItems(items);
  return db.$transaction(async (tx) => {
    await assertManagerWarehouse(tx, user, warehouseId);
    const [supplier, warehouse, supplierProducts] = await Promise.all([
      tx.supplier.findUnique({ where: { id: supplierId, isActive: true }, select: supplierSelect }),
      tx.warehouse.findUnique({ where: { id: warehouseId, isActive: true }, select: warehouseSelect }),
      tx.supplierProduct.findMany({ where: { supplierId, id: { in: items.map((item) => item.supplierProductId) }, isActive: true }, include: { variant: { select: { id: true, sku: true, isActive: true } } } }),
    ]);
    if (!supplier || !warehouse || supplierProducts.length !== items.length) throw new AppError('Supplier, warehouse, or supplier SKU is invalid.', { statusCode: 422, code: 'INVALID_PURCHASE_ORDER' });
    const byId = new Map(supplierProducts.map((item) => [item.id, item]));
    const currencies = new Set(supplierProducts.map((item) => item.currency));
    if (currencies.size !== 1) throw new AppError('All purchase-order lines must use one currency.', { statusCode: 422, code: 'MIXED_CURRENCIES' });
    const lines = items.map((item) => {
      const source = byId.get(item.supplierProductId);
      if (!source?.variant?.isActive) throw new AppError('Supplier SKU is inactive.', { statusCode: 422, code: 'INVALID_PURCHASE_ORDER' });
      if (item.quantity < source.minimumOrderQty || item.quantity % source.packSize !== 0) throw new AppError(`Quantity for ${source.variant.sku} must meet the minimum and pack size.`, { statusCode: 422, code: 'INVALID_ORDER_QUANTITY' });
      const unitCostCents = decimalToCents(source.unitCost);
      return { supplierProductId: source.id, variantId: source.variantId, quantityOrdered: item.quantity, unitCost: source.unitCost.toString(), lineTotal: centsToDecimal(unitCostCents * BigInt(item.quantity)), lineTotalCents: unitCostCents * BigInt(item.quantity) };
    });
    const totalAmount = centsToDecimal(lines.reduce((sum, line) => sum + line.lineTotalCents, 0n));
    const order = await tx.purchaseOrder.create({
      data: {
        orderNumber: `PO-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        supplierId,
        warehouseId,
        createdById: user.id,
        currency: [...currencies][0],
        totalAmount,
        items: { create: lines.map(({ lineTotalCents, ...line }) => line) },
      },
      include: purchaseOrderInclude,
    });
    return order;
  });
}

export async function findPurchaseOrder(db, user, purchaseOrderId) {
  return db.purchaseOrder.findFirst({ where: purchaseOrderWhere(user, purchaseOrderId), include: purchaseOrderInclude });
}

export async function listPurchaseOrders(db, user, { skip, take, status, supplierId, warehouseId }) {
  const where = { ...purchaseOrderWhere(user), ...(status ? { status } : {}), ...(supplierId ? { supplierId } : {}), ...(warehouseId ? { warehouseId } : {}) };
  const [orders, totalItems] = await db.$transaction([
    db.purchaseOrder.findMany({ where, include: purchaseOrderInclude, orderBy: { createdAt: 'desc' }, skip, take }),
    db.purchaseOrder.count({ where }),
  ]);
  return { orders, totalItems };
}

async function transitionPurchaseOrder(db, { user, purchaseOrderId, action, note }) {
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId}::uuid FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({ where: purchaseOrderWhere(user, purchaseOrderId), include: purchaseOrderInclude });
    if (!order) throw new AppError('Purchase order not found.', { statusCode: 404, code: 'NOT_FOUND' });
    const transitions = {
      submit: { from: ['DRAFT'], to: 'SUBMITTED' },
      accept: { from: ['SUBMITTED'], to: 'ACCEPTED' },
      reject: { from: ['SUBMITTED'], to: 'REJECTED' },
      cancel: { from: ['DRAFT', 'SUBMITTED'], to: 'CANCELLED' },
    };
    const transition = transitions[action];
    if (!transition.from.includes(order.status)) throw new AppError(`Purchase order cannot be ${action}ed from ${order.status}.`, { statusCode: 409, code: 'INVALID_STATE_TRANSITION' });
    if (['accept', 'reject'].includes(action) && !isAdmin(user) && !isSupplier(user)) throw new AppError('Only the assigned supplier or an admin can respond to a purchase order.', { statusCode: 403, code: 'FORBIDDEN' });
    if (action === 'cancel' && !isAdmin(user) && !isManager(user)) throw new AppError('Only a manager or admin can cancel a purchase order.', { statusCode: 403, code: 'FORBIDDEN' });
    return tx.purchaseOrder.update({ where: { id: order.id }, data: { status: transition.to }, include: purchaseOrderInclude });
  });
  return result;
}

export async function submitPurchaseOrder(db, args) { return transitionPurchaseOrder(db, { ...args, action: 'submit' }); }
export async function acceptPurchaseOrder(db, args) { return transitionPurchaseOrder(db, { ...args, action: 'accept' }); }
export async function rejectPurchaseOrder(db, args) { return transitionPurchaseOrder(db, { ...args, action: 'reject' }); }
export async function cancelPurchaseOrder(db, args) { return transitionPurchaseOrder(db, { ...args, action: 'cancel' }); }

function activeShippedQuantity(order, purchaseOrderItemId) {
  return order.shipments.filter((shipment) => shipment.status !== 'CANCELLED').flatMap((shipment) => shipment.shipmentItems).filter((item) => item.purchaseOrderItemId === purchaseOrderItemId).reduce((sum, item) => sum + item.quantityShipped, 0);
}

export async function createShipment(db, { user, purchaseOrderId, trackingNumber, items }) {
  assertUniquePositiveItems(items, 'purchaseOrderItemId');
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId}::uuid FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({ where: purchaseOrderWhere(user, purchaseOrderId), include: { items: true, shipments: { include: { shipmentItems: true } } } });
    if (!order) throw new AppError('Purchase order not found.', { statusCode: 404, code: 'NOT_FOUND' });
    if (!['ACCEPTED', 'PARTIALLY_SHIPPED'].includes(order.status)) throw new AppError('Shipments require an accepted purchase order.', { statusCode: 409, code: 'INVALID_STATE_TRANSITION' });
    const byId = new Map(order.items.map((item) => [item.id, item]));
    for (const line of items) {
      const orderItem = byId.get(line.purchaseOrderItemId);
      if (!orderItem || orderItem.variantId !== line.variantId && line.variantId) throw new AppError('Shipment item does not belong to this purchase order.', { statusCode: 422, code: 'INVALID_SHIPMENT' });
      const outstanding = orderItem.quantityOrdered - activeShippedQuantity(order, orderItem.id);
      if (line.quantity > outstanding) throw new AppError('Shipment quantity exceeds the outstanding quantity.', { statusCode: 409, code: 'SHIPMENT_OVER_RECEIPT' });
    }
    const now = new Date();
    const shipment = await tx.shipment.create({ data: { purchaseOrderId, status: 'SHIPPED', trackingNumber, shippedAt: now, shipmentItems: { create: items.map((item) => ({ purchaseOrderItemId: item.purchaseOrderItemId, variantId: item.variantId ?? byId.get(item.purchaseOrderItemId).variantId, quantityShipped: item.quantity })) } }, include: shipmentInclude });
    const shippedAfter = order.items.map((item) => activeShippedQuantity(order, item.id) + (items.find((line) => line.purchaseOrderItemId === item.id)?.quantity ?? 0));
    const nextStatus = shippedAfter.every((quantity, index) => quantity >= order.items[index].quantityOrdered) ? 'SHIPPED' : 'PARTIALLY_SHIPPED';
    await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: nextStatus } });
    return shipment;
  });
}

async function recalculateShipmentStatus(tx, purchaseOrderId) {
  const order = await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { items: true, shipments: { where: { status: { not: 'CANCELLED' } }, include: { shipmentItems: true } } } });
  if (!order || ['RECEIVED', 'PARTIALLY_RECEIVED'].includes(order.status)) return;
  const fullyShipped = order.items.every((item) => order.shipments.flatMap((shipment) => shipment.shipmentItems).filter((line) => line.purchaseOrderItemId === item.id).reduce((sum, line) => sum + line.quantityShipped, 0) >= item.quantityOrdered);
  const hasShipped = order.shipments.length > 0;
  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: fullyShipped ? 'SHIPPED' : hasShipped ? 'PARTIALLY_SHIPPED' : 'ACCEPTED' } });
}

export async function updateShipment(db, { user, shipmentId, status, trackingNumber }) {
  return db.$transaction(async (tx) => {
    const shipment = await tx.shipment.findFirst({ where: { id: shipmentId, purchaseOrder: purchaseOrderWhere(user) }, include: shipmentInclude });
    if (!shipment) throw new AppError('Shipment not found.', { statusCode: 404, code: 'NOT_FOUND' });
    const allowed = { PENDING: ['SHIPPED', 'CANCELLED'], SHIPPED: ['IN_TRANSIT', 'CANCELLED'], IN_TRANSIT: ['DELIVERED', 'CANCELLED'], DELIVERED: [], CANCELLED: [] };
    if (status && !allowed[shipment.status].includes(status)) throw new AppError(`Shipment cannot move from ${shipment.status} to ${status}.`, { statusCode: 409, code: 'INVALID_STATE_TRANSITION' });
    const updated = await tx.shipment.update({ where: { id: shipmentId }, data: { ...(status ? { status } : {}), ...(trackingNumber !== undefined ? { trackingNumber } : {}), ...(status === 'SHIPPED' && !shipment.shippedAt ? { shippedAt: new Date() } : {}), ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}) }, include: shipmentInclude });
    if (status === 'CANCELLED') await recalculateShipmentStatus(tx, shipment.purchaseOrderId);
    return updated;
  });
}

export async function listShipments(db, user, { skip, take, purchaseOrderId, warehouseId, status }) {
  const where = { ...(purchaseOrderId ? { purchaseOrderId } : {}), ...(warehouseId ? { purchaseOrder: { ...purchaseOrderWhere(user), warehouseId } } : { purchaseOrder: purchaseOrderWhere(user) }), ...(status ? { status } : {}) };
  const [shipments, totalItems] = await db.$transaction([
    db.shipment.findMany({ where, include: shipmentInclude, orderBy: { createdAt: 'desc' }, skip, take }),
    db.shipment.count({ where }),
  ]);
  return { shipments, totalItems };
}

export async function receiveGoods(tx, { user, purchaseOrderId, warehouseId, notes, items }) {
  assertUniquePositiveItems(items, 'purchaseOrderItemId');
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId}::uuid FOR UPDATE`;
  const order = await tx.purchaseOrder.findFirst({ where: purchaseOrderWhere(user, purchaseOrderId), include: { items: true, receipts: { include: { items: true } } } });
  if (!order) throw new AppError('Purchase order not found.', { statusCode: 404, code: 'NOT_FOUND' });
  if (order.warehouseId !== warehouseId) throw new AppError('Goods must be received into the purchase order warehouse.', { statusCode: 422, code: 'WAREHOUSE_MISMATCH' });
  if (!['SHIPPED', 'PARTIALLY_SHIPPED', 'PARTIALLY_RECEIVED'].includes(order.status)) throw new AppError('Goods can only be received after shipment.', { statusCode: 409, code: 'INVALID_STATE_TRANSITION' });
  const orderItems = new Map(order.items.map((item) => [item.id, item]));
  const receivedByItem = new Map();
  for (const receipt of order.receipts) for (const item of receipt.items) receivedByItem.set(item.purchaseOrderItemId, (receivedByItem.get(item.purchaseOrderItemId) ?? 0) + item.quantityReceived);
  for (const line of items) {
    const orderItem = orderItems.get(line.purchaseOrderItemId);
    if (!orderItem || orderItem.variantId !== line.variantId && line.variantId) throw new AppError('Receipt item does not belong to this purchase order.', { statusCode: 422, code: 'INVALID_GOODS_RECEIPT' });
    const outstanding = orderItem.quantityOrdered - (receivedByItem.get(orderItem.id) ?? 0);
    if (line.quantity > outstanding) throw new AppError('Received quantity exceeds the outstanding quantity.', { statusCode: 409, code: 'OVER_RECEIPT' });
  }
  const receipt = await tx.goodsReceipt.create({ data: { purchaseOrderId, warehouseId, receivedById: user.id, notes, items: { create: items.map((item) => ({ purchaseOrderItemId: item.purchaseOrderItemId, variantId: item.variantId ?? orderItems.get(item.purchaseOrderItemId).variantId, quantityReceived: item.quantity, batchCode: item.batchCode, expiryDate: item.expiryDate })) } }, include: { warehouse: { select: warehouseSelect }, receivedBy: { select: userSelect }, items: true } });
  for (const line of items) {
    const orderItem = orderItems.get(line.purchaseOrderItemId);
    let inventory = await tx.inventory.findUnique({ where: { warehouseId_variantId: { warehouseId, variantId: orderItem.variantId } } });
    if (inventory) {
      await tx.$queryRaw`SELECT id FROM "Inventory" WHERE id = ${inventory.id}::uuid FOR UPDATE`;
      inventory = await tx.inventory.findUnique({ where: { id: inventory.id } });
    } else {
      inventory = await tx.inventory.create({ data: { warehouseId, variantId: orderItem.variantId, onHandQuantity: 0 } });
    }
    const updatedInventory = await tx.inventory.update({ where: { id: inventory.id }, data: { onHandQuantity: { increment: line.quantity } } });
    if (line.batchCode) {
      await tx.inventoryBatch.upsert({ where: { inventoryId_batchCode: { inventoryId: inventory.id, batchCode: line.batchCode } }, update: { quantity: { increment: line.quantity }, expiryDate: line.expiryDate }, create: { inventoryId: inventory.id, batchCode: line.batchCode, expiryDate: line.expiryDate, quantity: line.quantity } });
    }
    await tx.inventoryMovement.create({ data: { inventoryId: inventory.id, warehouseId, variantId: orderItem.variantId, type: 'RECEIPT', quantity: line.quantity, onHandBefore: inventory.onHandQuantity, onHandAfter: updatedInventory.onHandQuantity, reservedBefore: inventory.reservedQuantity, reservedAfter: inventory.reservedQuantity, referenceType: 'GOODS_RECEIPT', referenceId: receipt.id, actorId: user.id, metadata: { purchaseOrderId, purchaseOrderItemId: orderItem.id, batchCode: line.batchCode ?? null } } });
    await tx.purchaseOrderItem.update({ where: { id: orderItem.id }, data: { quantityReceived: { increment: line.quantity } } });
  }
  const refreshedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId }, select: { quantityOrdered: true, quantityReceived: true } });
  const nextStatus = refreshedItems.every((item) => item.quantityReceived >= item.quantityOrdered) ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: nextStatus } });
  return receipt;
}

export async function listGoodsReceipts(db, user, { skip, take, purchaseOrderId, warehouseId }) {
  const visible = await visibleWarehouseIds(db, user, warehouseId);
  const where = { ...(purchaseOrderId ? { purchaseOrderId } : {}), ...(visible.length ? { warehouseId: { in: visible } } : { id: '__no_access__' }), purchaseOrder: purchaseOrderWhere(user) };
  const include = { warehouse: { select: warehouseSelect }, receivedBy: { select: userSelect }, items: { orderBy: { id: 'asc' } } };
  const [receipts, totalItems] = await db.$transaction([
    db.goodsReceipt.findMany({ where, include, orderBy: { receivedAt: 'desc' }, skip, take }),
    db.goodsReceipt.count({ where }),
  ]);
  return { receipts, totalItems };
}

export async function getTraceability(db, user, { variantId, warehouseId }) {
  let warehouseIds;
  if (isSupplier(user)) {
    const supplierOrders = await db.purchaseOrder.findMany({ where: purchaseOrderWhere(user), select: { warehouseId: true }, distinct: ['warehouseId'] });
    const supplierWarehouseIds = supplierOrders.map((order) => order.warehouseId);
    if (warehouseId && !supplierWarehouseIds.includes(warehouseId)) throw new AppError('You are not authorized to access this warehouse trace.', { statusCode: 403, code: 'FORBIDDEN' });
    warehouseIds = warehouseId ? [warehouseId] : supplierWarehouseIds;
  } else warehouseIds = await visibleWarehouseIds(db, user, warehouseId);
  if (!warehouseIds.length) throw new AppError('You are not authorized to view traceability.', { statusCode: 403, code: 'FORBIDDEN' });
  const variant = await db.productVariant.findUnique({ where: { id: variantId }, include: { product: { select: { id: true, name: true } } } });
  if (!variant) throw new AppError('SKU not found.', { statusCode: 404, code: 'NOT_FOUND' });
  const [movements, receipts, shipments] = await Promise.all([
    db.inventoryMovement.findMany({ where: { variantId, warehouseId: { in: warehouseIds } }, include: { warehouse: { select: warehouseSelect } }, orderBy: { createdAt: 'desc' }, take: 200 }),
    db.goodsReceiptItem.findMany({ where: { variantId, goodsReceipt: { warehouseId: { in: warehouseIds }, purchaseOrder: purchaseOrderWhere(user) } }, include: { goodsReceipt: { include: { warehouse: { select: warehouseSelect }, purchaseOrder: { include: { supplier: { select: supplierSelect } } } } } }, orderBy: { goodsReceipt: { receivedAt: 'desc' } }, take: 200 }),
    db.shipmentItem.findMany({ where: { variantId, shipment: { purchaseOrder: { warehouseId: { in: warehouseIds }, ...purchaseOrderWhere(user) } } }, include: { shipment: { include: { purchaseOrder: { include: { supplier: { select: supplierSelect }, warehouse: { select: warehouseSelect } } } } } }, orderBy: { shipment: { createdAt: 'desc' } }, take: 200 }),
  ]);
  return {
    variant: { id: variant.id, sku: variant.sku, productName: variant.product.name },
    movements: movements.map((item) => ({ id: item.id, type: item.type, quantity: item.quantity, warehouse: serializeWarehouse(item.warehouse), referenceType: item.referenceType, referenceId: item.referenceId, createdAt: item.createdAt.toISOString(), metadata: item.metadata })),
    receipts: receipts.map((item) => ({ id: item.goodsReceipt.id, purchaseOrderId: item.goodsReceipt.purchaseOrderId, supplier: serializeSupplier(item.goodsReceipt.purchaseOrder.supplier), warehouse: serializeWarehouse(item.goodsReceipt.warehouse), quantityReceived: item.quantityReceived, batchCode: item.batchCode, expiryDate: item.expiryDate?.toISOString().slice(0, 10) ?? null, receivedAt: item.goodsReceipt.receivedAt.toISOString() })),
    shipments: shipments.map((item) => ({ id: item.shipment.id, purchaseOrderId: item.shipment.purchaseOrderId, supplier: serializeSupplier(item.shipment.purchaseOrder.supplier), warehouse: serializeWarehouse(item.shipment.purchaseOrder.warehouse), status: item.shipment.status, trackingNumber: item.shipment.trackingNumber, quantityShipped: item.quantityShipped, shippedAt: item.shipment.shippedAt?.toISOString() ?? null, deliveredAt: item.shipment.deliveredAt?.toISOString() ?? null })),
  };
}

export async function approvePurchaseOrder(db, { user, purchaseOrderId }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId}::uuid FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({
      where: purchaseOrderWhere(user, purchaseOrderId),
      include: { items: true }
    });
    if (!order) throw new AppError('Purchase order not found.', { statusCode: 404, code: 'NOT_FOUND' });
    if (order.status !== 'SUBMITTED' && order.status !== 'ACCEPTED') {
      throw new AppError(`Cannot approve order in ${order.status} state.`, { statusCode: 409, code: 'INVALID_STATE' });
    }

    const receipt = await tx.goodsReceipt.create({
      data: {
        purchaseOrderId,
        warehouseId: order.warehouseId,
        receivedById: user.id,
        notes: 'Approved and received by Manager',
        items: {
          create: order.items.map(item => ({
            purchaseOrderItemId: item.id,
            variantId: item.variantId,
            quantityReceived: item.quantityOrdered,
          }))
        }
      }
    });

    for (const item of order.items) {
      const inventory = await tx.inventory.upsert({
        where: { warehouseId_variantId: { warehouseId: order.warehouseId, variantId: item.variantId } },
        update: { onHandQuantity: { increment: item.quantityOrdered } },
        create: {
          warehouseId: order.warehouseId,
          variantId: item.variantId,
          onHandQuantity: item.quantityOrdered,
        }
      });

      await tx.inventoryMovement.create({
        data: {
          inventoryId: inventory.id,
          warehouseId: order.warehouseId,
          variantId: item.variantId,
          type: 'RECEIPT',
          quantity: item.quantityOrdered,
          onHandBefore: inventory.onHandQuantity - item.quantityOrdered,
          onHandAfter: inventory.onHandQuantity,
          reservedBefore: inventory.reservedQuantity,
          reservedAfter: inventory.reservedQuantity,
          referenceType: 'PURCHASE_APPROVAL',
          referenceId: order.id,
          actorId: user.id,
        }
      });

      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { quantityReceived: { set: item.quantityOrdered } }
      });
    }

    const updatedOrder = await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status: 'RECEIVED' },
      include: purchaseOrderInclude
    });

    return updatedOrder;
  });
}

// (Remove the faulty export line entirely)

