import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateAnomaly, calculateRecommendation, exponentialSmoothing, sampleStandardDeviation } from '../src/services/formula.service.js';

describe('deterministic intelligence formulas', () => {
  it('uses sample standard deviation and exponential smoothing', () => {
    assert.equal(sampleStandardDeviation([1, 2, 3]), 1);
    assert.equal(exponentialSmoothing([2, 4, 6], 0.3), 4.6);
  });

  it('flags zero-variance spikes using the documented fallback rule', () => {
    const result = calculateAnomaly(3, [1, 1, 1, 1]);
    assert.equal(result.flagged, true);
    assert.equal(result.direction, 'SPIKE');
  });

  it('does not produce a precise reorder quantity with insufficient history', () => {
    const result = calculateRecommendation({ dailyValues: [4, 0, 0, 0, 0, 0], observedDays: 1, leadTimeDays: 5, minimumOrderQty: 20, packSize: 10, availableQuantity: 0 });
    assert.equal(result.sufficientHistory, false);
    assert.equal(result.recommendedQuantity, 0);
    assert.equal(result.priority, 'NONE');
  });

  it('rounds a sufficient-history quantity to MOQ and pack size', () => {
    const result = calculateRecommendation({ dailyValues: Array.from({ length: 28 }, () => 5), observedDays: 28, leadTimeDays: 5, minimumOrderQty: 20, packSize: 10, availableQuantity: 0 });
    assert.equal(result.sufficientHistory, true);
    assert.equal(result.recommendedQuantity, 30);
    assert.equal(result.priority, 'CRITICAL');
  });
});
