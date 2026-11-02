import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles, requireWarehouseAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeAudit } from '../services/audit.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getPagination } from '../utils/pagination.js';
import { createdResponse, paginatedResponse, successResponse } from '../utils/response.js';

const uuid = z.string().uuid();
const warehouseFields = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  addressLine1: z.string().trim().min(1).max(240),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().min(1).max(30),
  country: z.string().trim().min(1).max(80),
  isActive: z.boolean().default(true),
});
const createWarehouseRequest = z.object({ body: warehouseFields });
const updateWarehouseRequest = z.object({ body: warehouseFields.partial().extend({ warehouseId: uuid }).refine((body) => Object.keys(body).length > 1, 'At least one field is required.') });
const warehouseParams = z.object({ params: z.object({ warehouseId: uuid }) });
const inventoryListRequest = z.object({ params: z.object({ warehouseId: uuid }), query: z.object({ page: z.string().optional(), pageSize: z.string().optional(), sku: z.string().trim().max(80).optional(), lowStock: z.enum(['true', 'false']).default('false') }) });
const adjustmentRequest = z.object({
  params: z.object({ warehouseId: uuid }),
  body: z.object({ variantId: uuid, quantityDelta: z.number().int().refine((value) => value !== 0, 'Quantity delta cannot be zero.'), reason: z.string().trim().min(1).max(240).optional(), batchCode: z.string().trim().max(100).optional(), expiryDate: z.coerce.date().optional() }),
});
const transferRequest = z.object({
  params: z.object({ warehouseId: uuid }),
  body: z.object({ targetWarehouseId: uuid, variantId: uuid, quantity: z.number().int().positive(), reason: z.string().trim().max(240).optional() }),
});
const movementListRequest = z.object({
  params: z.object({ warehouseId: uuid }),
  query: z.object({ page: z.string().optional(), pageSize: z.string().optional(), variantId: uuid.optional(), type: z.enum(['RECEIPT', 'SALE', 'RESERVATION', 'RELEASE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN', 'DAMAGE']).optional() }),
});

function serializeWarehouse(warehouse) {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    addressLine1: warehouse.addressLine1,
    city: warehouse.city,
    state: warehouse.state,
    postalCode: warehouse.postalCode,
    country: warehouse.country,
    isActive: warehouse.isActive,
  };
}

function serializeInventory(inventory) {
  return {
    id: inventory.id,
    warehouseId: inventory.warehouseId,
    variantId: inventory.variantId,
    sku: inventory.variant.sku,
    productName: inventory.variant.product.name,
    onHandQuantity: inventory.onHandQuantity,
    reservedQuantity: inventory.reservedQuantity,
    availableQuantity: inventory.onHandQuantity - inventory.reservedQuantity,
    reorderLevel: inventory.reorderLevel,
    updatedAt: inventory.updatedAt,
  };
}

function serializeMovement(movement) {
  return {
    id: movement.id,
    warehouseId: movement.warehouseId,
    variantId: movement.variantId,
    sku: movement.variant.sku,
    productName: movement.variant.product.name,
    type: movement.type,
    quantity: movement.quantity,
    onHandBefore: movement.onHandBefore,
    onHandAfter: movement.onHandAfter,
    reservedBefore: movement.reservedBefore,
    reservedAfter: movement.reservedAfter,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    metadata: movement.metadata,
    createdAt: movement.createdAt,
  };
}

const inventoryInclude = { variant: { select: { sku: true, product: { select: { name: true } } } } };

export function createWarehouseRouter({ db }) {
  const router = Router();
  const authenticated = authenticate({ db });
  const managerOrAdmin = requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN'] });
  const readWarehouse = requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN', 'AUDITOR'] });
  const admin = requireRoles({ db, roles: ['ADMIN'] });

  router.get('/', authenticated, requireRoles({ db, roles: ['WAREHOUSE_MANAGER', 'ADMIN'] }), asyncHandler(async (request, response) => {
    const where = request.user.roleCodes.includes('ADMIN') ? { isActive: true } : { isActive: true, managers: { some: { managerId: request.user.id } } };
    const warehouses = await db.warehouse.findMany({ where, orderBy: { code: 'asc' } });
    return successResponse(request, response, warehouses.map(serializeWarehouse));
  }));

  router.post('/', authenticated, admin, validate(createWarehouseRequest), asyncHandler(async (request, response) => {
    const warehouse = await db.warehouse.create({ data: request.validated.body });
    await writeAudit(db, { actorId: request.user.id, action: 'WAREHOUSE_CREATED', resourceType: 'WAREHOUSE', resourceId: warehouse.id, correlationId: request.id });
    return createdResponse(request, response, serializeWarehouse(warehouse));
  }));

  router.patch('/', authenticated, admin, validate(updateWarehouseRequest), asyncHandler(async (request, response) => {
    const { warehouseId, ...data } = request.validated.body;
    const warehouse = await db.warehouse.update({ where: { id: warehouseId }, data });
    await writeAudit(db, { actorId: request.user.id, action: 'WAREHOUSE_UPDATED', resourceType: 'WAREHOUSE', resourceId: warehouse.id, correlationId: request.id, metadata: { fields: Object.keys(data) } });
    return successResponse(request, response, serializeWarehouse(warehouse));
  }));

  router.get('/:warehouseId/inventory', authenticated, readWarehouse, validate(inventoryListRequest), requireWarehouseAccess({ db }), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { sku, lowStock } = request.validated.query;
    const where = {
      warehouseId: request.validated.params.warehouseId,
      variant: {
        isActive: true,
        product: { isActive: true },
        ...(sku ? { sku: { contains: sku, mode: 'insensitive' } } : {}),
      },
    };
    if (lowStock === 'true') {
      const allInventory = await db.inventory.findMany({ where, include: inventoryInclude, orderBy: { updatedAt: 'desc' } });
      const filtered = allInventory.filter((row) => row.onHandQuantity - row.reservedQuantity <= row.reorderLevel);
      return paginatedResponse(request, response, filtered.slice(skip, skip + take).map(serializeInventory), { page, pageSize, totalItems: filtered.length });
    }
    const [inventory, totalItems] = await db.$transaction([
      db.inventory.findMany({ where, include: inventoryInclude, orderBy: { updatedAt: 'desc' }, skip, take }),
      db.inventory.count({ where }),
    ]);
    return paginatedResponse(request, response, inventory.map(serializeInventory), { page, pageSize, totalItems });
  }));

  router.post('/:warehouseId/inventory/adjustments', authenticated, managerOrAdmin, validate(adjustmentRequest), requireWarehouseAccess({ db }), asyncHandler(async (request, response) => {
    const { warehouseId } = request.validated.params;
    const { variantId, quantityDelta, reason, batchCode, expiryDate } = request.validated.body;
    const movement = await db.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId, isActive: true }, select: { id: true } });
      const variant = await tx.productVariant.findUnique({ where: { id: variantId, isActive: true }, select: { id: true } });
      if (!warehouse || !variant) throw new AppError('Warehouse or SKU is not active.', { statusCode: 422, code: 'INVALID_INVENTORY_TARGET' });
      let inventory = await tx.inventory.findUnique({ where: { warehouseId_variantId: { warehouseId, variantId } } });
      if (!inventory) {
        if (quantityDelta < 0) throw new AppError('Insufficient available stock.', { statusCode: 409, code: 'INSUFFICIENT_STOCK' });
        inventory = await tx.inventory.create({ data: { warehouseId, variantId, onHandQuantity: quantityDelta } });
      } else {
        await tx.$queryRaw`SELECT id FROM "Inventory" WHERE id = ${inventory.id}::uuid FOR UPDATE`;
        if (inventory.onHandQuantity + quantityDelta < inventory.reservedQuantity) throw new AppError('Adjustment would make available quantity negative.', { statusCode: 409, code: 'INVENTORY_INVARIANT_VIOLATION' });
        inventory = await tx.inventory.update({ where: { id: inventory.id }, data: { onHandQuantity: { increment: quantityDelta } } });
      }
      if (batchCode) {
        const currentBatch = await tx.inventoryBatch.findUnique({ where: { inventoryId_batchCode: { inventoryId: inventory.id, batchCode } }, select: { quantity: true } });
        if (quantityDelta < 0 && (!currentBatch || currentBatch.quantity + quantityDelta < 0)) throw new AppError('Batch quantity cannot become negative.', { statusCode: 409, code: 'INVENTORY_INVARIANT_VIOLATION' });
        await tx.inventoryBatch.upsert({ where: { inventoryId_batchCode: { inventoryId: inventory.id, batchCode } }, update: { quantity: { increment: quantityDelta }, expiryDate }, create: { inventoryId: inventory.id, batchCode, expiryDate, quantity: quantityDelta } });
      }
      return tx.inventoryMovement.create({ data: { inventoryId: inventory.id, warehouseId, variantId, type: 'ADJUSTMENT', quantity: Math.abs(quantityDelta), onHandBefore: inventory.onHandQuantity - quantityDelta, onHandAfter: inventory.onHandQuantity, reservedBefore: inventory.reservedQuantity, reservedAfter: inventory.reservedQuantity, actorId: request.user.id, metadata: { delta: quantityDelta, reason } }, include: { variant: { select: { sku: true, product: { select: { name: true } } } } } });
    });
    await writeAudit(db, { actorId: request.user.id, action: 'INVENTORY_ADJUSTED', resourceType: 'INVENTORY', resourceId: movement.id, correlationId: request.id, metadata: { warehouseId, variantId, quantityDelta, reason } });
    return createdResponse(request, response, serializeMovement(movement));
  }));

  router.post('/:warehouseId/inventory/transfers', authenticated, managerOrAdmin, validate(transferRequest), requireWarehouseAccess({ db }), asyncHandler(async (request, response) => {
    const { warehouseId } = request.validated.params;
    const { targetWarehouseId, variantId, quantity, reason } = request.validated.body;
    if (warehouseId === targetWarehouseId) throw new AppError('Source and target warehouses must differ.', { statusCode: 422, code: 'INVALID_TRANSFER' });
    if (request.user.roleCodes.includes('WAREHOUSE_MANAGER')) {
      const targetAssignment = await db.managerWarehouse.findUnique({ where: { managerId_warehouseId: { managerId: request.user.id, warehouseId: targetWarehouseId } } });
      if (!targetAssignment) throw new AppError('You are not authorized to access the target warehouse.', { statusCode: 403, code: 'FORBIDDEN' });
    }

    const transferId = randomUUID();
    const result = await db.$transaction(async (tx) => {
      const [sourceWarehouse, targetWarehouse, variant] = await Promise.all([
        tx.warehouse.findUnique({ where: { id: warehouseId, isActive: true }, select: { id: true } }),
        tx.warehouse.findUnique({ where: { id: targetWarehouseId, isActive: true }, select: { id: true } }),
        tx.productVariant.findUnique({ where: { id: variantId, isActive: true }, select: { id: true } }),
      ]);
      if (!sourceWarehouse || !targetWarehouse || !variant) throw new AppError('Transfer target is invalid.', { statusCode: 422, code: 'INVALID_TRANSFER' });
      await tx.$queryRaw`SELECT id FROM "Inventory" WHERE "warehouse_id" IN (${warehouseId}::uuid, ${targetWarehouseId}::uuid) AND "variant_id" = ${variantId}::uuid ORDER BY id FOR UPDATE`;
      const source = await tx.inventory.findUnique({ where: { warehouseId_variantId: { warehouseId, variantId } } });
      if (!source || source.onHandQuantity - source.reservedQuantity < quantity) throw new AppError('Insufficient available stock.', { statusCode: 409, code: 'INSUFFICIENT_STOCK' });
      const updatedSource = await tx.inventory.update({ where: { id: source.id }, data: { onHandQuantity: { decrement: quantity } } });
      const target = await tx.inventory.findUnique({ where: { warehouseId_variantId: { warehouseId: targetWarehouseId, variantId } } });
      const updatedTarget = target
        ? await tx.inventory.update({ where: { id: target.id }, data: { onHandQuantity: { increment: quantity } } })
        : await tx.inventory.create({ data: { warehouseId: targetWarehouseId, variantId, onHandQuantity: quantity } });
      const [outbound, inbound] = await Promise.all([
        tx.inventoryMovement.create({ data: { inventoryId: updatedSource.id, warehouseId, variantId, type: 'TRANSFER_OUT', quantity, onHandBefore: source.onHandQuantity, onHandAfter: updatedSource.onHandQuantity, reservedBefore: source.reservedQuantity, reservedAfter: updatedSource.reservedQuantity, referenceType: 'INVENTORY_TRANSFER', referenceId: transferId, actorId: request.user.id, metadata: { targetWarehouseId, reason } }, include: { variant: { select: { sku: true, product: { select: { name: true } } } } } }),
        tx.inventoryMovement.create({ data: { inventoryId: updatedTarget.id, warehouseId: targetWarehouseId, variantId, type: 'TRANSFER_IN', quantity, onHandBefore: target?.onHandQuantity ?? 0, onHandAfter: updatedTarget.onHandQuantity, reservedBefore: target?.reservedQuantity ?? 0, reservedAfter: updatedTarget.reservedQuantity, referenceType: 'INVENTORY_TRANSFER', referenceId: transferId, actorId: request.user.id, metadata: { sourceWarehouseId: warehouseId, reason } }, include: { variant: { select: { sku: true, product: { select: { name: true } } } } } }),
      ]);
      return { transferId, outbound, inbound };
    });
    await writeAudit(db, { actorId: request.user.id, action: 'INVENTORY_TRANSFERRED', resourceType: 'INVENTORY_TRANSFER', resourceId: result.transferId, correlationId: request.id, metadata: { warehouseId, targetWarehouseId, variantId, quantity, reason } });
    return createdResponse(request, response, { transferId: result.transferId, outbound: serializeMovement(result.outbound), inbound: serializeMovement(result.inbound) });
  }));

  router.get('/:warehouseId/movements', authenticated, readWarehouse, validate(movementListRequest), requireWarehouseAccess({ db }), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { variantId, type } = request.validated.query;
    const where = { warehouseId: request.validated.params.warehouseId, ...(variantId ? { variantId } : {}), ...(type ? { type } : {}) };
    const [movements, totalItems] = await db.$transaction([
      db.inventoryMovement.findMany({ where, include: { variant: { select: { sku: true, product: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, skip, take }),
      db.inventoryMovement.count({ where }),
    ]);
    return paginatedResponse(request, response, movements.map(serializeMovement), { page, pageSize, totalItems });
  }));

  return router;
}
