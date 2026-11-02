import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeAudit } from './audit.service.js';
import { AppError } from '../utils/app-error.js';
import { centsToDecimal, decimalToCents } from '../utils/money.js';
import { addDays, buildDateSeries, calculateAnomaly, calculateRecommendation, dateKey, dateOnly, FORMULA_VERSION, LOOKBACK_DAYS } from './formula.service.js';
import { visibleWarehouseIds } from './supply.service.js';
import { logger } from '../config/logger.js';

const variantSelect = { id: true, sku: true, price: true, currency: true, product: { select: { id: true, name: true } } };
const warehouseSelect = { id: true, code: true, name: true };
function isAdmin(user) { return user.roleCodes.includes('ADMIN'); }

function serializeForecast(forecast) {
  return { id: forecast.id, variantId: forecast.variantId, warehouseId: forecast.warehouseId, sku: forecast.variant?.sku, productName: forecast.variant?.product?.name, warehouse: forecast.warehouse, horizonDays: forecast.horizonDays, forecastStart: dateKey(forecast.forecastStart), forecastDailyDemand: forecast.forecastDailyDemand.toString(), predictedTotal: forecast.predictedTotal.toString(), formulaVersion: forecast.formulaVersion, inputs: forecast.inputs, createdAt: forecast.createdAt.toISOString(), lastRunAt: forecast.createdAt.toISOString() };
}

function serializeAnomaly(anomaly) {
  return { id: anomaly.id, variantId: anomaly.variantId, warehouseId: anomaly.warehouseId, sku: anomaly.variant?.sku, productName: anomaly.variant?.product?.name, warehouse: anomaly.warehouse, businessDate: dateKey(anomaly.businessDate), actualSales: anomaly.actualSales, expectedSales: anomaly.expectedSales.toString(), rollingStandardDeviation: anomaly.rollingStandardDeviation.toString(), zScore: anomaly.zScore.toString(), direction: anomaly.direction, createdAt: anomaly.createdAt.toISOString() };
}

export function serializeRecommendation(recommendation) {
  return { id: recommendation.id, variantId: recommendation.variantId, warehouseId: recommendation.warehouseId, sku: recommendation.variant?.sku, productName: recommendation.variant?.product?.name, warehouse: recommendation.warehouse, status: recommendation.status, priority: recommendation.priority, forecastDailyDemand: recommendation.forecastDailyDemand.toString(), leadTimeDays: recommendation.leadTimeDays, leadTimeDemand: recommendation.leadTimeDemand.toString(), safetyStock: recommendation.safetyStock.toString(), availableQuantity: recommendation.availableQuantity, recommendedQuantity: recommendation.recommendedQuantity, formulaVersion: recommendation.formulaVersion, explanation: recommendation.explanation, inputs: recommendation.inputs, purchaseOrder: recommendation.purchaseOrder ? { id: recommendation.purchaseOrder.id, orderNumber: recommendation.purchaseOrder.orderNumber, status: recommendation.purchaseOrder.status, totalAmount: recommendation.purchaseOrder.totalAmount.toString() } : null, decisionBy: recommendation.decisionBy ? { id: recommendation.decisionBy.id, email: recommendation.decisionBy.email, fullName: recommendation.decisionBy.fullName } : null, decisionAt: recommendation.decisionAt?.toISOString() ?? null, createdAt: recommendation.createdAt.toISOString(), updatedAt: recommendation.updatedAt.toISOString(), lastRunAt: recommendation.createdAt.toISOString() };
}

const forecastInclude = { variant: { select: variantSelect }, warehouse: { select: warehouseSelect } };
const anomalyInclude = { variant: { select: variantSelect }, warehouse: { select: warehouseSelect } };
const recommendationInclude = { variant: { select: variantSelect }, warehouse: { select: warehouseSelect }, purchaseOrder: { select: { id: true, orderNumber: true, status: true, totalAmount: true } }, decisionBy: { select: { id: true, email: true, fullName: true } } };

function parseDateRange({ fromDate, toDate }) {
  const end = dateOnly(toDate ?? new Date());
  const start = dateOnly(fromDate ?? addDays(end, -(LOOKBACK_DAYS - 1)));
  if (start > end) throw new AppError('fromDate must be on or before toDate.', { statusCode: 422, code: 'INVALID_DATE_RANGE' });
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days > 366) throw new AppError('The intelligence date range cannot exceed 366 days.', { statusCode: 422, code: 'INVALID_DATE_RANGE' });
  return { start, end, endExclusive: addDays(end, 1), days };
}

async function getBatchMLForecasts(requests, horizonDays) {
  if (!requests.length) return { forecasts: {}, modelName: null };

  const scriptPath = fileURLToPath(new URL('../../../ml/predict_demand.py', import.meta.url));
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    let settled = false;
    let py;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      py?.kill('SIGTERM');
      finish(reject, new AppError('The demand model timed out. Try a smaller warehouse or date range.', { statusCode: 503, code: 'MODEL_TIMEOUT' }));
    }, 60000);

    try {
      py = spawn(process.env.PYTHON_EXECUTABLE || 'python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      finish(reject, new AppError('Could not start the demand model. Check the Python installation.', { statusCode: 503, code: 'MODEL_UNAVAILABLE', cause: error }));
      return;
    }

    py.stdout.on('data', (data) => { output += data; });
    py.stderr.on('data', (data) => { errorOutput += data; });
    py.stdin.on('error', (error) => {
      logger.warn({ err: error }, 'Could not send the demand batch to Python');
    });
    py.on('error', (error) => {
      logger.error({ err: error }, 'Could not start the demand model process');
      finish(reject, new AppError('Could not start the demand model. Check Python and its model dependencies.', { statusCode: 503, code: 'MODEL_UNAVAILABLE' }));
    });
    py.on('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        let detail = '';
        try { detail = JSON.parse(output).error ?? ''; } catch {}
        logger.error({ code, signal, pythonError: detail, errorOutput: errorOutput.slice(0, 2000), output: output.slice(0, 2000) }, 'Demand model process failed');
        finish(reject, new AppError('The demand model failed to run. Check that the selected model artifact and Python dependencies are available.', { statusCode: 503, code: 'MODEL_EXECUTION_FAILED' }));
        return;
      }

      try {
        const result = JSON.parse(output);
        if (result.error || !Array.isArray(result.results)) throw new Error(result.error || 'The model returned no prediction results.');
        const failed = result.results.find((item) => item.error || !Number.isFinite(item.prediction));
        if (failed) throw new Error(failed.error || 'The model returned an invalid prediction.');
        const requestedIds = new Set(requests.map(({ variantId }) => variantId));
        const returnedIds = new Set(result.results.map(({ variantId }) => variantId));
        if (returnedIds.size !== requestedIds.size || [...requestedIds].some((id) => !returnedIds.has(id))) {
          throw new Error('The model did not return exactly one prediction for every requested SKU.');
        }
        const forecasts = Object.fromEntries(result.results.map(({ variantId, prediction }) => [variantId, prediction]));
        finish(resolve, { forecasts, modelName: result.modelName ?? 'Recursive lag-7 baseline' });
      } catch (error) {
        logger.error({ err: error, output: output.slice(0, 2000) }, 'Demand model returned invalid output');
        finish(reject, error instanceof AppError ? error : new AppError('The demand model returned invalid output.', { statusCode: 503, code: 'MODEL_INVALID_OUTPUT' }));
      }
    });

    py.stdin.end(JSON.stringify({ requests, horizonDays }));
  });
}

export async function runIntelligence(db, { user, warehouseId, variantIds, fromDate, toDate, horizonDays = 14, correlationId }) {
  logger.info({ userId: user.id, warehouseId, variantIds }, 'Starting runIntelligence');
  const warehouseIds = await visibleWarehouseIds(db, user, warehouseId);
  if (!warehouseIds.length) throw new AppError('No authorized active warehouses are available.', { statusCode: 403, code: 'FORBIDDEN' });
  const range = parseDateRange({ fromDate, toDate });
  const variants = await db.productVariant.findMany({ where: { isActive: true, ...(variantIds?.length ? { id: { in: variantIds } } : {}) }, select: variantSelect, orderBy: { sku: 'asc' } });
  if (!variants.length) throw new AppError('No active SKU matched the intelligence request.', { statusCode: 422, code: 'NO_VARIANTS' });
  
  let totalForecasts = 0;
  let totalAnomalies = 0;
  let totalRecommendations = 0;
  let processedVariantCount = 0;
  let insufficientHistoryCount = 0;
  const hasExplicitVariantSelection = Boolean(variantIds?.length);
  const noSalesWarehouseIds = [];
  const modelNames = new Set();

  for (const currentWarehouseId of warehouseIds) {
    // Read only real transaction movements. A full-warehouse run should not synthesize zero-sales rows for the entire catalog.
    const movements = await db.inventoryMovement.findMany({ 
      where: { 
        warehouseId: currentWarehouseId, 
        type: { in: ['SALE', 'RETURN'] }, 
        createdAt: { gte: range.start, lt: range.endExclusive },
        variantId: { in: variants.map(v => v.id) }
      }, 
      select: { variantId: true, quantity: true, createdAt: true, type: true } 
    });

    if (!movements.length && !hasExplicitVariantSelection) {
      await db.$transaction([
        db.salesHistoryDaily.deleteMany({ where: { warehouseId: currentWarehouseId, businessDate: { gte: range.start, lt: range.endExclusive }, unitsSold: 0, revenue: 0 } }),
        db.demandForecast.deleteMany({ where: { warehouseId: currentWarehouseId, forecastDailyDemand: 0, predictedTotal: 0 } }),
        db.demandAnomaly.deleteMany({ where: { warehouseId: currentWarehouseId, businessDate: { gte: range.start, lt: range.endExclusive } } }),
        db.reorderRecommendation.deleteMany({ where: { warehouseId: currentWarehouseId, status: 'INSUFFICIENT_HISTORY', recommendedQuantity: 0, purchaseOrderId: null, decisionAt: null } }),
      ]);
      noSalesWarehouseIds.push(currentWarehouseId);
      continue;
    }

    const variantHistoryMap = new Map();
    for (const movement of movements) {
      if (!variantHistoryMap.has(movement.variantId)) variantHistoryMap.set(movement.variantId, new Map());
      const key = dateKey(movement.createdAt);
      const sign = movement.type === 'RETURN' ? -1 : 1;
      const current = variantHistoryMap.get(movement.variantId).get(key) ?? 0;
      variantHistoryMap.get(movement.variantId).set(key, current + sign * movement.quantity);
    }
    for (const dailyUnits of variantHistoryMap.values()) {
      for (const [key, value] of dailyUnits) dailyUnits.set(key, Math.max(0, value));
    }

    const warehouseVariants = hasExplicitVariantSelection
      ? variants
      : variants.filter((variant) => variantHistoryMap.has(variant.id));
    if (!warehouseVariants.length) {
      noSalesWarehouseIds.push(currentWarehouseId);
      continue;
    }

    const inventories = await db.inventory.findMany({
      where: { warehouseId: currentWarehouseId, variantId: { in: warehouseVariants.map(v => v.id) } },
      select: { variantId: true, onHandQuantity: true, reservedQuantity: true }
    });
    const invMap = new Map(inventories.map(i => [i.variantId, i]));

    const mlRequests = [];
    const variantProcessedData = [];

    for (const variant of warehouseVariants) {
      const dailyUnits = variantHistoryMap.get(variant.id) ?? new Map();
      const series = buildDateSeries(range.start, range.end, dailyUnits);
      const observedDays = series.filter((point) => point.value > 0).length;
      if (observedDays >= 7) {
        mlRequests.push({
          variantId: variant.id,
          history: series.map((point) => ({ date: point.date, value: point.value })),
        });
      }

      variantProcessedData.push({
        variant,
        series,
        observedDays,
        inventory: invMap.get(variant.id)
      });
    }

    processedVariantCount += variantProcessedData.length;
    insufficientHistoryCount += variantProcessedData.filter(({ observedDays }) => observedDays < 7).length;

    // Run the selected model only for SKUs with enough observed sales to support it.
    const { forecasts: mlForecasts, modelName } = await getBatchMLForecasts(mlRequests, horizonDays);
    if (modelName) modelNames.add(modelName);

    // 3. Bulk Save everything for the Warehouse
    await db.$transaction(async (tx) => {
      const historyRecords = [];
      const forecastRecords = [];
      const recsRecords = [];
      const anomaliesRecords = [];

      // Get supplier products for all variants in warehouse
      const supplierProducts = await tx.supplierProduct.findMany({
        where: { variantId: { in: warehouseVariants.map(v => v.id) }, isActive: true, supplier: { isActive: true } },
        orderBy: [{ leadTimeDays: 'asc' }, { id: 'asc' }]
      });
      const spMap = new Map();
      for (const sp of supplierProducts) {
        if (!spMap.has(sp.variantId)) spMap.set(sp.variantId, sp);
      }

      for (const { variant, series, observedDays, inventory } of variantProcessedData) {
        // A. Sales History Bulk Data
        series.forEach(point => {
          const unitsSold = Math.max(0, Math.round(point.value));
          const revenueCents = decimalToCents(variant.price) * BigInt(unitsSold);
          historyRecords.push({
            variantId: variant.id,
            warehouseId: currentWarehouseId,
            businessDate: dateOnly(point.date),
            unitsSold,
            revenue: centsToDecimal(revenueCents),
            stockoutFlag: Boolean(inventory && inventory.onHandQuantity - inventory.reservedQuantity <= 0)
          });
        });

        // B. Forecasts
        const mlForecast = mlForecasts[variant.id] ?? null;
        const forecastCalc = calculateRecommendation({ 
          dailyValues: series.map(p => p.value), 
          observedDays, 
          leadTimeDays: 0, minimumOrderQty: 0, packSize: 1, availableQuantity: 0, 
          horizonDays, externalForecast: mlForecast 
        });
        
        if (forecastCalc.sufficientHistory || hasExplicitVariantSelection) {
          forecastRecords.push({
            variantId: variant.id,
            warehouseId: currentWarehouseId,
            horizonDays,
            forecastStart: addDays(range.end, 1),
            forecastDailyDemand: forecastCalc.forecastDailyDemand.toFixed(4),
            predictedTotal: forecastCalc.predictedTotal.toFixed(2),
            formulaVersion: FORMULA_VERSION,
            inputs: { lookbackDays: series.length, observedSalesDays: observedDays, dailySales: series, alpha: 0.30, generatedFor: dateKey(range.end), mlForecast }
          });
        }

        // C. Anomalies
        for (let index = 1; index < series.length; index += 1) {
          const window = series.slice(Math.max(0, index - LOOKBACK_DAYS), index).map(p => p.value);
          const result = calculateAnomaly(series[index].value, window);
          if (result.flagged) {
            anomaliesRecords.push({
              variantId: variant.id,
              warehouseId: currentWarehouseId,
              businessDate: dateOnly(series[index].date),
              actualSales: Math.max(0, Math.round(series[index].value)),
              expectedSales: result.expected.toFixed(4),
              rollingStandardDeviation: result.standardDeviation.toFixed(4),
              zScore: result.zScore.toFixed(4),
              direction: result.direction
            });
          }
        }

        // D. Recommendations
        const supplierProduct = spMap.get(variant.id);
        const availableQuantity = (inventory?.onHandQuantity ?? 0) - (inventory?.reservedQuantity ?? 0);
        const recCalc = calculateRecommendation({ 
          dailyValues: series.map(p => p.value), 
          observedDays, 
          leadTimeDays: supplierProduct?.leadTimeDays ?? 0, 
          minimumOrderQty: supplierProduct?.minimumOrderQty ?? 0, 
          packSize: supplierProduct?.packSize ?? 1, 
          availableQuantity, 
          horizonDays, 
          externalForecast: mlForecast 
        });

        const status = !supplierProduct || !recCalc.sufficientHistory ? 'INSUFFICIENT_HISTORY' : 'PENDING';
        const explanation = !supplierProduct
          ? 'No active supplier SKU is configured for this product variant.'
          : !recCalc.sufficientHistory
            ? `Only ${observedDays} days with sales are available; at least 7 are required before forecasting demand or recommending a replenishment quantity.`
            : `Forecast ${recCalc.forecastDailyDemand.toFixed(4)} units/day (${mlForecast !== null ? 'Recursive lag-7 model' : 'Algorithmic fallback'}); lead-time demand ${recCalc.leadTimeDemand.toFixed(2)}; safety stock ${recCalc.safetyStock.toFixed(2)}; available ${availableQuantity}; recommend ${recCalc.recommendedQuantity} units.`;

        recsRecords.push({
          variantId: variant.id,
          warehouseId: currentWarehouseId,
          status,
          priority: status === 'PENDING' ? recCalc.priority : 'NONE',
          forecastDailyDemand: recCalc.forecastDailyDemand.toFixed(4),
          leadTimeDays: supplierProduct?.leadTimeDays ?? 0,
          leadTimeDemand: recCalc.leadTimeDemand.toFixed(2),
          safetyStock: recCalc.safetyStock.toFixed(2),
          availableQuantity,
          recommendedQuantity: status === 'PENDING' ? recCalc.recommendedQuantity : 0,
          formulaVersion: FORMULA_VERSION,
          explanation,
          inputs: { lookbackDays: series.length, observedSalesDays: observedDays, dailySales: series, alpha: 0.30, z: 1.65, leadTimeDays: supplierProduct?.leadTimeDays ?? 0, minimumOrderQty: supplierProduct?.minimumOrderQty ?? 0, packSize: supplierProduct?.packSize ?? 1, availableQuantity, horizonDays, supplierProductId: supplierProduct?.id ?? null, mlForecast },
        });
      }

      // EXTREME OPTIMIZATION: Bulk execute all writes for the whole warehouse
      await tx.salesHistoryDaily.deleteMany({ where: { warehouseId: currentWarehouseId, businessDate: { gte: range.start, lt: range.endExclusive } } });
      await tx.salesHistoryDaily.createMany({ data: historyRecords });
      await tx.demandForecast.deleteMany({ where: { warehouseId: currentWarehouseId } });
      await tx.demandForecast.createMany({ data: forecastRecords });
      await tx.demandAnomaly.deleteMany({ where: { warehouseId: currentWarehouseId, businessDate: { gte: range.start, lt: range.endExclusive } } });
      await tx.demandAnomaly.createMany({ data: anomaliesRecords });
      
      // Recommendations need to be upserted or deleted/created
      await tx.reorderRecommendation.deleteMany({ where: { warehouseId: currentWarehouseId } });
      await tx.reorderRecommendation.createMany({ data: recsRecords });

      totalForecasts += forecastRecords.length;
      totalAnomalies += anomaliesRecords.length;
      totalRecommendations += recsRecords.length;
    });
  }

  if (!processedVariantCount && !hasExplicitVariantSelection) {
    throw new AppError(
      `No sales or returns were recorded for the selected warehouse in the last ${range.days} days. The demand model needs recent sales history; record completed customer sales for this warehouse and try again.`,
      { statusCode: 422, code: 'INSUFFICIENT_SALES_HISTORY' },
    );
  }
  
  await writeAudit(db, { actorId: user.id, action: 'INTELLIGENCE_RUN', resourceType: 'INTELLIGENCE_RUN', correlationId, metadata: { forecastCount: totalForecasts, anomalyCount: totalAnomalies, recommendationCount: totalRecommendations, warehouseIds, variantCount: processedVariantCount, fromDate: dateKey(range.start), toDate: dateKey(range.end), horizonDays } });
  const skippedVariantCount = Math.max(0, variants.length * warehouseIds.length - processedVariantCount);
  const noForecastMessage = totalForecasts === 0
    ? `Sales were found, but none of the ${processedVariantCount} SKUs had 7 or more days with sales. No demand forecast was generated.`
    : null;
  const modelName = modelNames.size ? [...modelNames].join(', ') : null;
  const skippedMessage = [
    skippedVariantCount ? `${skippedVariantCount} SKUs with no recent sales were skipped.` : '',
    insufficientHistoryCount ? `${insufficientHistoryCount} SKUs with fewer than 7 sales days were skipped.` : '',
    noSalesWarehouseIds.length ? `${noSalesWarehouseIds.length} warehouses had no recent sales.` : '',
  ].filter(Boolean).join(' ');
  const message = noForecastMessage ?? `Generated ${totalForecasts} forecasts${modelName ? ` with ${modelName}` : ''}.${skippedMessage ? ` ${skippedMessage}` : ''}`;
  return { forecastCount: totalForecasts, anomalyCount: totalAnomalies, recommendationCount: totalRecommendations, insufficientHistoryCount, skippedVariantCount, modelName, message, formulaVersion: FORMULA_VERSION, fromDate: dateKey(range.start), toDate: dateKey(range.end), warehouseIds, noSalesWarehouseIds, variantCount: processedVariantCount };
}

async function scopedList(db, user, { warehouseId, variantId, skip, take, kind, status, priority }) {
  const warehouseIds = await visibleWarehouseIds(db, user, warehouseId);
  const where = { warehouseId: { in: warehouseIds.length ? warehouseIds : ['__no_access__'] }, ...(variantId ? { variantId } : {}) };
  if (kind === 'recommendations') Object.assign(where, { ...(status ? { status } : {}), ...(priority ? { priority } : {}) });
  const model = kind === 'forecasts' ? db.demandForecast : kind === 'anomalies' ? db.demandAnomaly : db.reorderRecommendation;
  const include = kind === 'forecasts' ? forecastInclude : kind === 'anomalies' ? anomalyInclude : kind === 'recommendations' ? recommendationInclude : null;
  const orderBy = kind === 'forecasts' ? { createdAt: 'desc' } : kind === 'anomalies' ? { businessDate: 'desc' } : { createdAt: 'desc' };
  const [rows, totalItems] = await db.$transaction([model.findMany({ where, include, orderBy, skip, take }), model.count({ where })]);
  return { rows, totalItems };
}

export async function listForecasts(db, user, options) { return scopedList(db, user, { ...options, kind: 'forecasts' }); }
export async function listAnomalies(db, user, options) { return scopedList(db, user, { ...options, kind: 'anomalies' }); }
export async function listRecommendations(db, user, options) { return scopedList(db, user, { ...options, kind: 'recommendations' }); }

export async function listSalesHistory(db, user, { warehouseId, variantId, fromDate, toDate, skip, take }) {
  const warehouseIds = await visibleWarehouseIds(db, user, warehouseId);
  const range = fromDate || toDate ? parseDateRange({ fromDate, toDate }) : null;
  const where = { warehouseId: { in: warehouseIds.length ? warehouseIds : ['__no_access__'] }, ...(variantId ? { variantId } : {}), ...(range ? { businessDate: { gte: range.start, lte: range.end } } : {}) };
  const [rows, totalItems] = await db.$transaction([
    db.salesHistoryDaily.findMany({ where, include: { variant: { select: variantSelect }, warehouse: { select: warehouseSelect } }, orderBy: { businessDate: 'desc' }, skip, take }),
    db.salesHistoryDaily.count({ where }),
  ]);
  return { rows, totalItems };
}

async function findRecommendationForDecision(tx, user, recommendationId) {
  const where = isAdmin(user) ? { id: recommendationId } : { id: recommendationId, warehouse: { managers: { some: { managerId: user.id } } } };
  return tx.reorderRecommendation.findFirst({ where, include: recommendationInclude });
}

export async function approveRecommendation(tx, { user, recommendationId, correlationId }) {
  await tx.$queryRaw`SELECT id FROM "ReorderRecommendation" WHERE id = ${recommendationId}::uuid FOR UPDATE`;
  const recommendation = await findRecommendationForDecision(tx, user, recommendationId);
  if (!recommendation) throw new AppError('Recommendation not found.', { statusCode: 404, code: 'NOT_FOUND' });
  if (recommendation.status !== 'PENDING') throw new AppError('Only pending recommendations can be approved.', { statusCode: 409, code: 'INVALID_RECOMMENDATION_STATE' });
  if (recommendation.recommendedQuantity <= 0) throw new AppError('This recommendation has no replenishment quantity.', { statusCode: 409, code: 'EMPTY_RECOMMENDATION' });
  const supplierProduct = await tx.supplierProduct.findFirst({ where: { variantId: recommendation.variantId, isActive: true, supplier: { isActive: true } }, orderBy: [{ leadTimeDays: 'asc' }, { id: 'asc' }] });
  if (!supplierProduct) throw new AppError('No active supplier SKU is available for this recommendation.', { statusCode: 409, code: 'NO_SUPPLIER_SOURCE' });
  const totalAmount = centsToDecimal(decimalToCents(supplierProduct.unitCost) * BigInt(recommendation.recommendedQuantity));
  const order = await tx.purchaseOrder.create({ data: { orderNumber: `PO-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`, supplierId: supplierProduct.supplierId, warehouseId: recommendation.warehouseId, createdById: user.id, currency: supplierProduct.currency, totalAmount, items: { create: { supplierProductId: supplierProduct.id, variantId: recommendation.variantId, quantityOrdered: recommendation.recommendedQuantity, unitCost: supplierProduct.unitCost, lineTotal: totalAmount } } } });
  const updated = await tx.reorderRecommendation.update({ where: { id: recommendation.id }, data: { status: 'APPROVED', purchaseOrderId: order.id, decisionById: user.id, decisionAt: new Date() }, include: recommendationInclude });
  await writeAudit(tx, { actorId: user.id, action: 'RECOMMENDATION_APPROVED', resourceType: 'REORDER_RECOMMENDATION', resourceId: recommendation.id, correlationId, metadata: { purchaseOrderId: order.id, recommendedQuantity: recommendation.recommendedQuantity } });
  return updated;
}

export async function rejectRecommendation(tx, { user, recommendationId, reason, correlationId }) {
  await tx.$queryRaw`SELECT id FROM "ReorderRecommendation" WHERE id = ${recommendationId}::uuid FOR UPDATE`;
  const recommendation = await findRecommendationForDecision(tx, user, recommendationId);
  if (!recommendation) throw new AppError('Recommendation not found.', { statusCode: 404, code: 'NOT_FOUND' });
  if (recommendation.status !== 'PENDING') throw new AppError('Only pending recommendations can be rejected.', { statusCode: 409, code: 'INVALID_RECOMMENDATION_STATE' });
  const updated = await tx.reorderRecommendation.update({ where: { id: recommendation.id }, data: { status: 'REJECTED', decisionById: user.id, decisionAt: new Date(), explanation: reason ? `${recommendation.explanation} Rejected: ${reason}` : `${recommendation.explanation} Rejected.` }, include: recommendationInclude });
  await writeAudit(tx, { actorId: user.id, action: 'RECOMMENDATION_REJECTED', resourceType: 'REORDER_RECOMMENDATION', resourceId: recommendation.id, correlationId, metadata: { reason: reason ?? null } });
  return updated;
}

export async function getRecommendation(db, user, recommendationId) {
  const where = isAdmin(user) || user.roleCodes.includes('AUDITOR') ? { id: recommendationId } : { id: recommendationId, warehouse: { managers: { some: { managerId: user.id } } } };
  return db.reorderRecommendation.findFirst({ where, include: recommendationInclude });
}

export { serializeForecast, serializeAnomaly };
