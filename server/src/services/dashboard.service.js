import { AppError } from '../utils/app-error.js';
import { centsToDecimal, decimalToCents } from '../utils/money.js';
import { addDays, dateKey, dateOnly } from './formula.service.js';
import { visibleWarehouseIds } from './supply.service.js';

const OPEN_PO_STATUSES = ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED'];

function parseDashboardRange({ fromDate, toDate }) {
  const end = dateOnly(toDate ?? new Date());
  const start = dateOnly(fromDate ?? addDays(end, -13));
  if (start > end) throw new AppError('fromDate must be on or before toDate.', { statusCode: 422, code: 'INVALID_DATE_RANGE' });
  return { start, end, endExclusive: addDays(end, 1) };
}

function rankPriority(priority) { return ({ CRITICAL: 0, HIGH: 1, NORMAL: 2, NONE: 3 })[priority] ?? 4; }

export async function getManagerDashboard(db, { user, warehouseId, fromDate, toDate }) {
  const warehouseIds = await visibleWarehouseIds(db, user, warehouseId);
  if (!warehouseIds.length) throw new AppError('No authorized warehouses are available.', { statusCode: 403, code: 'FORBIDDEN' });
  const range = parseDashboardRange({ fromDate, toDate });
  const inventory = await db.inventory.findMany({ where: { warehouseId: { in: warehouseIds } }, include: { warehouse: { select: { id: true, code: true, name: true } }, variant: { select: { id: true, sku: true, price: true, product: { select: { name: true } } } } } });
  const [openPurchaseOrders, criticalAlerts, recommendations, anomalies, sales] = await Promise.all([
    db.purchaseOrder.count({ where: { warehouseId: { in: warehouseIds }, status: { in: OPEN_PO_STATUSES } } }),
    db.reorderRecommendation.count({ where: { warehouseId: { in: warehouseIds }, status: 'PENDING', priority: 'CRITICAL' } }),
    db.reorderRecommendation.findMany({ where: { warehouseId: { in: warehouseIds }, status: 'PENDING' }, include: { variant: { select: { sku: true, product: { select: { name: true } } } }, warehouse: { select: { code: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.demandAnomaly.findMany({ where: { warehouseId: { in: warehouseIds }, businessDate: { gte: range.start, lt: range.endExclusive } }, include: { variant: { select: { sku: true, product: { select: { name: true } } } }, warehouse: { select: { code: true, name: true } } }, orderBy: { businessDate: 'desc' }, take: 50 }),
    db.salesHistoryDaily.findMany({ where: { warehouseId: { in: warehouseIds }, businessDate: { gte: range.start, lt: range.endExclusive } }, select: { businessDate: true, unitsSold: true, revenue: true } }),
  ]);
  let stockValueCents = 0n;
  const lowStock = [];
  for (const row of inventory) {
    stockValueCents += decimalToCents(row.variant.price) * BigInt(row.onHandQuantity);
    if (row.onHandQuantity - row.reservedQuantity <= row.reorderLevel) lowStock.push({ warehouse: row.warehouse, sku: row.variant.sku, productName: row.variant.product.name, availableQuantity: row.onHandQuantity - row.reservedQuantity, reorderLevel: row.reorderLevel });
  }
  const trendByDate = new Map();
  for (const row of sales) {
    const key = dateKey(row.businessDate);
    const current = trendByDate.get(key) ?? { businessDate: key, unitsSold: 0, revenue: 0n };
    current.unitsSold += row.unitsSold;
    current.revenue += decimalToCents(row.revenue);
    trendByDate.set(key, current);
  }
  const salesTrend = [...trendByDate.values()].sort((left, right) => left.businessDate.localeCompare(right.businessDate)).map((row) => ({ businessDate: row.businessDate, unitsSold: row.unitsSold, revenue: centsToDecimal(row.revenue) }));
  return {
    scope: { warehouseIds, fromDate: dateKey(range.start), toDate: dateKey(range.end) },
    cards: { stockValue: centsToDecimal(stockValueCents), lowStockCount: lowStock.length, openPurchaseOrders, criticalAlerts, anomalyCount: anomalies.length },
    lowStock: lowStock.slice(0, 50),
    salesTrend,
    recommendations: recommendations.sort((left, right) => rankPriority(left.priority) - rankPriority(right.priority) || right.createdAt - left.createdAt).slice(0, 20).map((row) => ({ id: row.id, sku: row.variant.sku, productName: row.variant.product.name, warehouse: row.warehouse, priority: row.priority, recommendedQuantity: row.recommendedQuantity, availableQuantity: row.availableQuantity, explanation: row.explanation })),
    anomalies: anomalies.map((row) => ({ id: row.id, businessDate: dateKey(row.businessDate), sku: row.variant.sku, productName: row.variant.product.name, warehouse: row.warehouse, direction: row.direction, actualSales: row.actualSales, zScore: row.zScore.toString() })),
  };
}

export async function getAdminDashboard(db, { fromDate, toDate }) {
  const range = parseDashboardRange({ fromDate, toDate });
  const [users, products, variants, warehouses, suppliers, openPurchaseOrders, inventory, anomalies, auditLogs] = await Promise.all([
    db.user.count({ where: { isActive: true } }),
    db.product.count({ where: { isActive: true } }),
    db.productVariant.count({ where: { isActive: true } }),
    db.warehouse.count({ where: { isActive: true } }),
    db.supplier.count({ where: { isActive: true } }),
    db.purchaseOrder.count({ where: { status: { in: OPEN_PO_STATUSES } } }),
    db.inventory.findMany({ include: { variant: { select: { price: true } } } }),
    db.demandAnomaly.count({ where: { businessDate: { gte: range.start, lt: range.endExclusive } } }),
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { actor: { select: { email: true, fullName: true } } } }),
  ]);
  const stockValueCents = inventory.reduce((sum, row) => sum + decimalToCents(row.variant.price) * BigInt(row.onHandQuantity), 0n);
  return { scope: { fromDate: dateKey(range.start), toDate: dateKey(range.end) }, cards: { activeUsers: users, activeProducts: products, activeVariants: variants, activeWarehouses: warehouses, activeSuppliers: suppliers, openPurchaseOrders, anomalyCount: anomalies, stockValue: centsToDecimal(stockValueCents) }, recentAudit: auditLogs.map((row) => ({ id: row.id, action: row.action, resourceType: row.resourceType, outcome: row.outcome, actor: row.actor, createdAt: row.createdAt.toISOString() })) };
}

export async function getSupplierDashboard(db, { user, supplierId }) {
  if (!user.roleCodes.includes('SUPPLIER') && !supplierId) throw new AppError('supplierId is required for an admin supplier dashboard.', { statusCode: 422, code: 'VALIDATION_ERROR' });
  const supplier = user.roleCodes.includes('SUPPLIER')
    ? await db.supplier.findFirst({ where: { userId: user.id, isActive: true }, select: { id: true, code: true, name: true, email: true } })
    : await db.supplier.findUnique({ where: { id: supplierId, isActive: true }, select: { id: true, code: true, name: true, email: true } });
  if (!supplier) throw new AppError('Supplier account not found.', { statusCode: 404, code: 'NOT_FOUND' });
  const [orders, shipments, products] = await Promise.all([
    db.purchaseOrder.findMany({ where: { supplierId: supplier.id }, include: { warehouse: { select: { code: true, name: true } }, items: { select: { quantityOrdered: true, quantityReceived: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    db.shipment.count({ where: { purchaseOrder: { supplierId: supplier.id }, status: { in: ['PENDING', 'SHIPPED', 'IN_TRANSIT'] } } }),
    db.supplierProduct.count({ where: { supplierId: supplier.id, isActive: true } }),
  ]);
  const openOrders = orders.filter((order) => OPEN_PO_STATUSES.includes(order.status));
  const outstandingUnits = openOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantityOrdered - item.quantityReceived, 0), 0);
  return { supplier, cards: { activeSupplierProducts: products, openPurchaseOrders: openOrders.length, activeShipments: shipments, outstandingUnits }, purchaseOrders: orders.map((order) => ({ id: order.id, orderNumber: order.orderNumber, status: order.status, warehouse: order.warehouse, totalAmount: order.totalAmount.toString(), outstandingUnits: order.items.reduce((sum, item) => sum + item.quantityOrdered - item.quantityReceived, 0), createdAt: order.createdAt.toISOString() })) };
}
