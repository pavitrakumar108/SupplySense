import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:4000/api/v1';

async function call(path, { token, method = 'GET', body, headers = {}, expect = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status !== expect) throw new Error(`${method} ${path} expected ${expect}, received ${response.status}: ${JSON.stringify(payload)}`);
  return payload.data;
}

async function login(email, password) {
  const data = await call('/auth/login', { method: 'POST', body: { email, password }, expect: 200 });
  return data.accessToken;
}

const managerToken = await login('manager@supplysense.local', 'Manager!12345');
const supplierToken = await login('supplier@supplysense.local', 'Supplier!12345');
const adminToken = await login('admin@supplysense.local', 'ChangeMe!12345');
const warehouses = await call('/warehouses', { token: managerToken });
const warehouse = warehouses[0];
const suppliers = await call('/suppliers', { token: adminToken });
const supplier = suppliers[0];
const supplierProducts = await call(`/suppliers/${supplier.id}/products`, { token: adminToken });
const supplierProduct = supplierProducts[0];

const purchaseOrder = await call('/purchase-orders', { token: managerToken, method: 'POST', body: { supplierId: supplier.id, warehouseId: warehouse.id, items: [{ supplierProductId: supplierProduct.id, quantity: 20 }] }, expect: 201 });
assert.equal(purchaseOrder.status, 'DRAFT');
const submitted = await call(`/purchase-orders/${purchaseOrder.id}/submit`, { token: managerToken, method: 'POST', body: {}, expect: 200 });
assert.equal(submitted.status, 'SUBMITTED');
const accepted = await call(`/purchase-orders/${purchaseOrder.id}/accept`, { token: supplierToken, method: 'POST', body: {}, expect: 200 });
assert.equal(accepted.status, 'ACCEPTED');
const poItem = accepted.items[0];
const shipment = await call(`/purchase-orders/${purchaseOrder.id}/shipments`, { token: supplierToken, method: 'POST', body: { trackingNumber: `LOCAL-${Date.now()}`, items: [{ purchaseOrderItemId: poItem.id, quantity: 20 }] }, expect: 201 });
assert.equal(shipment.status, 'SHIPPED');

const receiptOneBody = { warehouseId: warehouse.id, notes: 'Local partial receipt one', items: [{ purchaseOrderItemId: poItem.id, quantity: 5, batchCode: `BATCH-${Date.now()}-1` }] };
const receiptOneKey = `phase9-receipt-${Date.now()}-one`;
const receiptOne = await call(`/purchase-orders/${purchaseOrder.id}/goods-receipts`, { token: managerToken, method: 'POST', body: receiptOneBody, headers: { 'Idempotency-Key': receiptOneKey }, expect: 201 });
const receiptOneReplay = await call(`/purchase-orders/${purchaseOrder.id}/goods-receipts`, { token: managerToken, method: 'POST', body: receiptOneBody, headers: { 'Idempotency-Key': receiptOneKey }, expect: 201 });
assert.equal(receiptOneReplay.id, receiptOne.id);
const receiptTwo = await call(`/purchase-orders/${purchaseOrder.id}/goods-receipts`, { token: managerToken, method: 'POST', body: { warehouseId: warehouse.id, notes: 'Local partial receipt two', items: [{ purchaseOrderItemId: poItem.id, quantity: 15, batchCode: `BATCH-${Date.now()}-2` }] }, headers: { 'Idempotency-Key': `phase9-receipt-${Date.now()}-two` }, expect: 201 });
assert.equal(receiptTwo.purchaseOrderId, purchaseOrder.id);
const completedOrder = await call(`/purchase-orders/${purchaseOrder.id}`, { token: managerToken });
assert.equal(completedOrder.status, 'RECEIVED');
assert.equal(completedOrder.items[0].quantityReceived, 20);
const trace = await call(`/traceability/${supplierProduct.variantId}?warehouseId=${warehouse.id}`, { token: managerToken });
assert.equal(trace.receipts.length >= 2, true);
assert.equal(trace.shipments.length >= 1, true);
const supplierTrace = await call(`/traceability/${supplierProduct.variantId}?warehouseId=${warehouse.id}`, { token: supplierToken });
assert.equal(supplierTrace.receipts.length >= 2, true);

const today = new Date().toISOString().slice(0, 10);
const start = new Date(`${today}T00:00:00.000Z`);
start.setUTCDate(start.getUTCDate() - 27);
const fromDate = start.toISOString().slice(0, 10);
const intelligence = await call('/intelligence/run', { token: managerToken, method: 'POST', body: { warehouseId: warehouse.id, variantIds: [supplierProduct.variantId], fromDate, toDate: today, horizonDays: 14 }, expect: 200 });
assert.equal(intelligence.forecastCount, 1);
const salesHistory = await call(`/analytics/sales-history?warehouseId=${warehouse.id}&variantId=${supplierProduct.variantId}&pageSize=100`, { token: managerToken });
assert.equal(salesHistory.length, 28);
const forecasts = await call(`/analytics/forecasts?warehouseId=${warehouse.id}&variantId=${supplierProduct.variantId}&pageSize=10`, { token: managerToken });
assert.equal(forecasts.length >= 1, true);
const recommendations = await call(`/recommendations?warehouseId=${warehouse.id}&variantId=${supplierProduct.variantId}&pageSize=10`, { token: managerToken });
assert.equal(recommendations.length >= 1, true);
const managerDashboard = await call(`/dashboards/manager?warehouseId=${warehouse.id}`, { token: managerToken });
assert.equal(typeof managerDashboard.cards.stockValue, 'string');
const adminDashboard = await call('/dashboards/admin', { token: adminToken });
assert.equal(typeof adminDashboard.cards.activeUsers, 'number');
const supplierDashboard = await call('/dashboards/supplier', { token: supplierToken });
assert.equal(supplierDashboard.supplier.id, supplier.id);

console.log(JSON.stringify({ purchaseOrderId: purchaseOrder.id, shipmentId: shipment.id, receiptIds: [receiptOne.id, receiptTwo.id], intelligence, salesHistoryRows: salesHistory.length, forecastRows: forecasts.length, recommendationRows: recommendations.length, managerCards: managerDashboard.cards, adminCards: adminDashboard.cards, supplierCards: supplierDashboard.cards }, null, 2));
