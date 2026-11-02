export const FORMULA_VERSION = 'v1.2-recursive-lag7';
export const LOOKBACK_DAYS = 28;
export const DEFAULT_ALPHA = 0.30;
export const DEFAULT_Z = 1.65;

export function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

export function dateOnly(value) {
  return new Date(`${dateKey(value)}T00:00:00.000Z`);
}

export function addDays(value, days) {
  const date = dateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function buildDateSeries(fromDate, toDate, valuesByDate = new Map()) {
  const start = dateOnly(fromDate);
  const end = dateOnly(toDate);
  const values = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = dateKey(cursor);
    values.push({ date: key, value: Number(valuesByDate.get(key) ?? 0) });
  }
  return values;
}

export function arithmeticMean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

export function sampleStandardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = arithmeticMean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((Number(value) - mean) ** 2), 0) / (values.length - 1));
}

export function exponentialSmoothing(values, alpha = DEFAULT_ALPHA) {
  if (!values.length) return 0;
  let forecast = Math.max(0, arithmeticMean(values));
  for (const value of values.slice(1)) forecast = Math.max(0, alpha * Number(value) + (1 - alpha) * forecast);
  return forecast;
}

export function calculateAnomaly(value, valuesBeforeOrWindow) {
  const window = valuesBeforeOrWindow.map(Number);
  const expected = arithmeticMean(window);
  const standardDeviation = sampleStandardDeviation(window);
  if (standardDeviation === 0) {
    if (expected > 0 && value >= 2 * expected) return { flagged: true, expected, standardDeviation, zScore: 0, direction: 'SPIKE' };
    return { flagged: false, expected, standardDeviation, zScore: 0, direction: null };
  }
  const zScore = (Number(value) - expected) / standardDeviation;
  const flagged = Math.abs(zScore) >= 3;
  return { flagged, expected, standardDeviation, zScore, direction: zScore >= 0 ? 'SPIKE' : 'DROP' };
}

export function calculateRecommendation({ dailyValues, observedDays, leadTimeDays, minimumOrderQty, packSize, availableQuantity, horizonDays = 14, alpha = DEFAULT_ALPHA, z = DEFAULT_Z, externalForecast = null }) {
  const normalizedPackSize = Math.max(1, Number(packSize) || 1);
  const normalizedLeadTime = Math.max(0, Number(leadTimeDays) || 0);
  const observed = Number(observedDays);
  const sigma = sampleStandardDeviation(dailyValues);
  
  // Use the selected external model forecast if available; otherwise use exponential smoothing.
  const forecastDailyDemand = externalForecast !== null 
    ? Number(externalForecast) 
    : exponentialSmoothing(dailyValues, alpha);
    
  const leadTimeDemand = forecastDailyDemand * normalizedLeadTime;
  const safetyStock = z * sigma * Math.sqrt(normalizedLeadTime);
  const reorderPoint = leadTimeDemand + safetyStock;
  const baseQuantity = Math.max(0, reorderPoint - Number(availableQuantity));
  const recommendedQuantity = baseQuantity > 0
    ? Math.max(Number(minimumOrderQty) || 0, Math.ceil(baseQuantity / normalizedPackSize) * normalizedPackSize)
    : 0;
  let priority = 'NONE';
  if (recommendedQuantity > 0) {
    priority = Number(availableQuantity) <= 0 ? 'CRITICAL' : Number(availableQuantity) <= reorderPoint * 0.5 ? 'CRITICAL' : Number(availableQuantity) <= reorderPoint ? 'HIGH' : 'NORMAL';
  }
  const sufficientHistory = observed >= 7;
  return {
    sufficientHistory,
    forecastDailyDemand,
    predictedTotal: forecastDailyDemand * Math.max(1, Number(horizonDays) || 1),
    standardDeviation: sigma,
    leadTimeDemand,
    safetyStock,
    reorderPoint,
    recommendedQuantity: sufficientHistory ? recommendedQuantity : 0,
    priority: sufficientHistory ? priority : 'NONE',
  };
}
