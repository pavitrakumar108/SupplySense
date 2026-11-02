import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeAudit } from '../services/audit.service.js';
import {
  acceptPurchaseOrder,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  createShipment,
  createSupplier,
  createSupplierProduct,
  findPurchaseOrder,
  getTraceability,
  listGoodsReceipts,
  listPurchaseOrders,
  listShipments,
  listSupplierProducts,
  listSuppliers,
  receiveGoods,
  rejectPurchaseOrder,
  serializeGoodsReceipt,
  serializePurchaseOrder,
  serializeShipment,
  serializeSupplier,
  serializeSupplierProduct,
  submitPurchaseOrder,
  updateShipment,
  updateSupplier,
  updateSupplierProduct,
} from '../services/supply.service.js';
import { executeIdempotent, getIdempotencyKey } from '../services/idempotency.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getPagination } from '../utils/pagination.js';
import { createdResponse, paginatedResponse, successResponse } from '../utils/response.js';

const uuid = z.string().uuid();
const money = z.union([z.string(), z.number()]).transform(String).refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), 'Amount must be a non-negative decimal with up to two decimal places.');
const supplierFields = z.object({ code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(160), email: z.string().email().max(320).optional().nullable(), isActive: z.boolean().default(true) });
const supplierCollectionUpdateRequest = z.object({ body: supplierFields.partial().extend({ supplierId: uuid }).refine((body) => Object.keys(body).length > 1, 'At least one field is required.') });
const supplierProductFields = z.object({ variantId: uuid, supplierSku: z.string().trim().max(80).optional().nullable(), unitCost: money, currency: z.string().trim().length(3).toUpperCase().default('USD'), leadTimeDays: z.number().int().min(0), minimumOrderQty: z.number().int().min(0).default(0), packSize: z.number().int().positive().default(1), isActive: z.boolean().default(true) });
const listQuery = z.object({ page: z.string().optional(), pageSize: z.string().optional(), search: z.string().trim().max(160).optional(), status: z.enum(['DRAFT', 'SUBMITTED', 'ACCEPTED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'REJECTED']).optional(), supplierId: uuid.optional(), warehouseId: uuid.optional(), purchaseOrderId: uuid.optional(), variantId: uuid.optional() });
const shipmentListQuery = z.object({ page: z.string().optional(), pageSize: z.string().optional(), status: z.enum(['PENDING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']).optional(), purchaseOrderId: uuid.optional(), warehouseId: uuid.optional() });
const supplierParams = z.object({ params: z.object({ supplierId: uuid }) });
const supplierProductParams = z.object({ params: z.object({ supplierId: uuid, supplierProductId: uuid }) });
const createSupplierProductRequest = z.object({ params: z.object({ supplierId: uuid }), body: supplierProductFields });
const updateSupplierProductCollectionRequest = z.object({ params: z.object({ supplierId: uuid }), body: supplierProductFields.partial().extend({ supplierProductId: uuid }).refine((body) => Object.keys(body).length > 1, 'At least one field is required.') });
const updateSupplierProductRequest = z.object({ params: z.object({ supplierId: uuid, supplierProductId: uuid }), body: supplierProductFields.partial().refine((body) => Object.keys(body).length > 0, 'At least one field is required.') });
const createPurchaseOrderRequest = z.object({ body: z.object({ supplierId: uuid, warehouseId: uuid, items: z.array(z.object({ supplierProductId: uuid, quantity: z.number().int().positive() })).min(1).max(100) }) });
const poParams = z.object({ params: z.object({ purchaseOrderId: uuid }) });
const shipmentItem = z.object({ purchaseOrderItemId: uuid, variantId: uuid.optional(), quantity: z.number().int().positive() });
const createShipmentRequest = z.object({ params: z.object({ purchaseOrderId: uuid }), body: z.object({ trackingNumber: z.string().trim().max(160).optional(), items: z.array(shipmentItem).min(1).max(100) }) });
const updateShipmentRequest = z.object({ params: z.object({ shipmentId: uuid }), body: z.object({ status: z.enum(['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']).optional(), trackingNumber: z.string().trim().max(160).optional().nullable() }).refine((body) => body.status !== undefined || body.trackingNumber !== undefined, 'A shipment field is required.') });
const receiptItem = z.object({ purchaseOrderItemId: uuid, variantId: uuid.optional(), quantity: z.number().int().positive(), batchCode: z.string().trim().max(100).optional(), expiryDate: z.coerce.date().optional() });
const createReceiptRequest = z.object({ params: z.object({ purchaseOrderId: uuid }), body: z.object({ warehouseId: uuid, notes: z.string().trim().max(1000).optional(), items: z.array(receiptItem).min(1).max(100) }) });
const traceabilityRequest = z.object({ params: z.object({ variantId: uuid }), query: z.object({ warehouseId: uuid.optional() }) });

function sendIdempotent(request, response, result) {
  return successResponse(request, response, result.data, result.statusCode);
}

export function createSupplyRouter({ db }) {
  const router = Router();
  const authenticated = authenticate({ db });
  const admin = [authenticated, requireRoles({ db, roles: ['ADMIN'] })];
  const supplyReaders = [authenticated, requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN', 'AUDITOR', 'SUPPLIER'] })];
  const poCreators = [authenticated, requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN'] })];
  const supplierResponders = [authenticated, requireRoles({ db, roles: ['ADMIN', 'SUPPLIER'] })];
  const receiptActors = [authenticated, requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN'] })];

  router.get('/suppliers', ...supplyReaders, validate(z.object({ query: z.object({ page: z.string().optional(), pageSize: z.string().optional(), search: z.string().trim().max(160).optional() }) })), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { suppliers, totalItems } = await listSuppliers(db, request.user, { skip, take, search: request.validated.query.search });
    return paginatedResponse(request, response, suppliers.map(serializeSupplier), { page, pageSize, totalItems });
  }));

  router.post('/suppliers', ...admin, validate(z.object({ body: supplierFields })), asyncHandler(async (request, response) => {
    const supplier = await createSupplier(db, request.validated.body);
    await writeAudit(db, { actorId: request.user.id, action: 'SUPPLIER_CREATED', resourceType: 'SUPPLIER', resourceId: supplier.id, correlationId: request.id });
    return createdResponse(request, response, serializeSupplier(supplier));
  }));

  router.patch('/suppliers', ...admin, validate(supplierCollectionUpdateRequest), asyncHandler(async (request, response) => {
    const { supplierId, ...data } = request.validated.body;
    const supplier = await updateSupplier(db, supplierId, data);
    await writeAudit(db, { actorId: request.user.id, action: 'SUPPLIER_UPDATED', resourceType: 'SUPPLIER', resourceId: supplier.id, correlationId: request.id, metadata: { fields: Object.keys(data) } });
    return successResponse(request, response, serializeSupplier(supplier));
  }));

  router.patch('/suppliers/:supplierId', ...admin, validate(supplierParams.extend({ body: supplierFields.partial().refine((body) => Object.keys(body).length > 0, 'At least one field is required.') })), asyncHandler(async (request, response) => {
    const supplier = await updateSupplier(db, request.validated.params.supplierId, request.validated.body);
    await writeAudit(db, { actorId: request.user.id, action: 'SUPPLIER_UPDATED', resourceType: 'SUPPLIER', resourceId: supplier.id, correlationId: request.id, metadata: { fields: Object.keys(request.validated.body) } });
    return successResponse(request, response, serializeSupplier(supplier));
  }));

  router.get('/suppliers/:supplierId/products', ...supplyReaders, validate(z.object({ params: z.object({ supplierId: uuid }), query: z.object({ page: z.string().optional(), pageSize: z.string().optional(), variantId: uuid.optional() }) })), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { products, totalItems } = await listSupplierProducts(db, request.user, request.validated.params.supplierId, { skip, take, variantId: request.validated.query.variantId });
    return paginatedResponse(request, response, products.map(serializeSupplierProduct), { page, pageSize, totalItems });
  }));

  router.post('/suppliers/:supplierId/products', ...admin, validate(createSupplierProductRequest), asyncHandler(async (request, response) => {
    const product = await createSupplierProduct(db, { supplierId: request.validated.params.supplierId, ...request.validated.body });
    await writeAudit(db, { actorId: request.user.id, action: 'SUPPLIER_PRODUCT_CREATED', resourceType: 'SUPPLIER_PRODUCT', resourceId: product.id, correlationId: request.id });
    return createdResponse(request, response, serializeSupplierProduct(product));
  }));

  router.patch('/suppliers/:supplierId/products', ...admin, validate(updateSupplierProductCollectionRequest), asyncHandler(async (request, response) => {
    const { supplierProductId, ...data } = request.validated.body;
    const existing = await db.supplierProduct.findFirst({ where: { id: supplierProductId, supplierId: request.validated.params.supplierId }, select: { id: true } });
    if (!existing) throw new AppError('Supplier product not found.', { statusCode: 404, code: 'NOT_FOUND' });
    const product = await updateSupplierProduct(db, existing.id, data);
    await writeAudit(db, { actorId: request.user.id, action: 'SUPPLIER_PRODUCT_UPDATED', resourceType: 'SUPPLIER_PRODUCT', resourceId: product.id, correlationId: request.id, metadata: { fields: Object.keys(data) } });
    return successResponse(request, response, serializeSupplierProduct(product));
  }));

  router.patch('/suppliers/:supplierId/products/:supplierProductId', ...admin, validate(updateSupplierProductRequest), asyncHandler(async (request, response) => {
    const existing = await db.supplierProduct.findFirst({ where: { id: request.validated.params.supplierProductId, supplierId: request.validated.params.supplierId }, select: { id: true } });
    if (!existing) throw new AppError('Supplier product not found.', { statusCode: 404, code: 'NOT_FOUND' });
    const product = await updateSupplierProduct(db, existing.id, request.validated.body);
    await writeAudit(db, { actorId: request.user.id, action: 'SUPPLIER_PRODUCT_UPDATED', resourceType: 'SUPPLIER_PRODUCT', resourceId: product.id, correlationId: request.id, metadata: { fields: Object.keys(request.validated.body) } });
    return successResponse(request, response, serializeSupplierProduct(product));
  }));

  router.post('/purchase-orders/:purchaseOrderId/approve', ...receiptActors, validate(poParams), asyncHandler(async (request, response) => {
    const order = await approvePurchaseOrder(db, { user: request.user, purchaseOrderId: request.validated.params.purchaseOrderId });
    await writeAudit(db, { actorId: request.user.id, action: 'PURCHASE_ORDER_APPROVED', resourceType: 'PURCHASE_ORDER', resourceId: order.id, correlationId: request.id });
    return successResponse(request, response, serializePurchaseOrder(order));
  }));

  router.get('/purchase-orders', ...supplyReaders, validate(z.object({ query: listQuery })), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { orders, totalItems } = await listPurchaseOrders(db, request.user, { skip, take, status: request.validated.query.status, supplierId: request.validated.query.supplierId, warehouseId: request.validated.query.warehouseId });
    return paginatedResponse(request, response, orders.map(serializePurchaseOrder), { page, pageSize, totalItems });
  }));

  router.post('/purchase-orders', ...poCreators, validate(createPurchaseOrderRequest), asyncHandler(async (request, response) => {
    const order = await createPurchaseOrder(db, { user: request.user, ...request.validated.body });
    await writeAudit(db, { actorId: request.user.id, action: 'PURCHASE_ORDER_CREATED', resourceType: 'PURCHASE_ORDER', resourceId: order.id, correlationId: request.id, metadata: { orderNumber: order.orderNumber } });
    return createdResponse(request, response, serializePurchaseOrder(order));
  }));

  router.get('/purchase-orders/:purchaseOrderId', ...supplyReaders, validate(poParams), asyncHandler(async (request, response) => {
    const order = await findPurchaseOrder(db, request.user, request.validated.params.purchaseOrderId);
    if (!order) throw new AppError('Purchase order not found.', { statusCode: 404, code: 'NOT_FOUND' });
    return successResponse(request, response, serializePurchaseOrder(order));
  }));

  for (const [path, action, auditAction] of [['submit', submitPurchaseOrder, 'PURCHASE_ORDER_SUBMITTED'], ['accept', acceptPurchaseOrder, 'PURCHASE_ORDER_ACCEPTED'], ['reject', rejectPurchaseOrder, 'PURCHASE_ORDER_REJECTED'], ['cancel', cancelPurchaseOrder, 'PURCHASE_ORDER_CANCELLED']]) {
    const middleware = ['accept', 'reject'].includes(path) ? supplierResponders : path === 'cancel' ? poCreators : poCreators;
    router.post(`/purchase-orders/:purchaseOrderId/${path}`, ...middleware, validate(poParams), asyncHandler(async (request, response) => {
      const order = await action(db, { user: request.user, purchaseOrderId: request.validated.params.purchaseOrderId, note: request.body?.reason, correlationId: request.id });
      await writeAudit(db, { actorId: request.user.id, action: auditAction, resourceType: 'PURCHASE_ORDER', resourceId: order.id, correlationId: request.id });
      return successResponse(request, response, serializePurchaseOrder(order));
    }));
  }

  router.get('/purchase-orders/:purchaseOrderId/shipments', ...supplyReaders, validate(poParams), asyncHandler(async (request, response) => {
    const { shipments } = await listShipments(db, request.user, { skip: 0, take: 100, purchaseOrderId: request.validated.params.purchaseOrderId });
    return successResponse(request, response, shipments.map(serializeShipment));
  }));

  router.post('/purchase-orders/:purchaseOrderId/shipments', ...supplierResponders, validate(createShipmentRequest), asyncHandler(async (request, response) => {
    const shipment = await createShipment(db, { user: request.user, purchaseOrderId: request.validated.params.purchaseOrderId, trackingNumber: request.validated.body.trackingNumber, items: request.validated.body.items });
    await writeAudit(db, { actorId: request.user.id, action: 'SHIPMENT_CREATED', resourceType: 'SHIPMENT', resourceId: shipment.id, correlationId: request.id, metadata: { purchaseOrderId: shipment.purchaseOrderId } });
    return createdResponse(request, response, serializeShipment(shipment));
  }));

  router.get('/shipments', ...supplyReaders, validate(z.object({ query: shipmentListQuery })), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { shipments, totalItems } = await listShipments(db, request.user, { skip, take, purchaseOrderId: request.validated.query.purchaseOrderId, warehouseId: request.validated.query.warehouseId, status: request.validated.query.status });
    return paginatedResponse(request, response, shipments.map(serializeShipment), { page, pageSize, totalItems });
  }));

  router.patch('/shipments/:shipmentId', ...supplierResponders, validate(updateShipmentRequest), asyncHandler(async (request, response) => {
    const shipment = await updateShipment(db, { user: request.user, shipmentId: request.validated.params.shipmentId, ...request.validated.body });
    await writeAudit(db, { actorId: request.user.id, action: 'SHIPMENT_UPDATED', resourceType: 'SHIPMENT', resourceId: shipment.id, correlationId: request.id, metadata: { status: shipment.status } });
    return successResponse(request, response, serializeShipment(shipment));
  }));

  router.get('/goods-receipts', ...receiptActors, validate(z.object({ query: listQuery })), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { receipts, totalItems } = await listGoodsReceipts(db, request.user, { skip, take, purchaseOrderId: request.validated.query.purchaseOrderId, warehouseId: request.validated.query.warehouseId });
    return paginatedResponse(request, response, receipts.map(serializeGoodsReceipt), { page, pageSize, totalItems });
  }));

  router.post('/purchase-orders/:purchaseOrderId/goods-receipts', ...receiptActors, validate(createReceiptRequest), asyncHandler(async (request, response) => {
    const key = getIdempotencyKey(request);
    const payload = request.validated.body;
    const result = await executeIdempotent({
      db,
      userId: request.user.id,
      key,
      operation: 'GOODS_RECEIPT_CREATE',
      payload: { purchaseOrderId: request.validated.params.purchaseOrderId, ...payload },
      handler: async (tx) => ({ statusCode: 201, data: serializeGoodsReceipt(await receiveGoods(tx, { user: request.user, purchaseOrderId: request.validated.params.purchaseOrderId, ...payload, items: payload.items })) }),
    });
    if (!result.replayed) await writeAudit(db, { actorId: request.user.id, action: 'GOODS_RECEIPT_CREATED', resourceType: 'GOODS_RECEIPT', resourceId: result.data.id, correlationId: request.id, metadata: { purchaseOrderId: request.validated.params.purchaseOrderId } });
    return sendIdempotent(request, response, result);
  }));

  router.get('/traceability/:variantId', ...supplyReaders, validate(traceabilityRequest), asyncHandler(async (request, response) => {
    const data = await getTraceability(db, request.user, { variantId: request.validated.params.variantId, warehouseId: request.validated.query.warehouseId });
    return successResponse(request, response, data);
  }));

  return router;
}
