# Business Rules and Invariants

These rules are implementation-independent. Services, database constraints, and tests must enforce them together.

## 1. Identity and catalog

1. Email addresses are unique after canonicalization.
2. Passwords are stored only as slow password hashes.
3. A SKU is globally unique and belongs to exactly one product variant record.
4. Only active products, variants, and prices can be purchased.
5. Prices are calculated from server-side records. Client-submitted totals are never trusted.
6. Historical order items preserve the name, SKU, unit price, and tax/shipping values used at purchase time.

## 2. Inventory

1. Inventory belongs to a `(warehouse, variant)` pair.
2. There must be at most one inventory row for a pair.
3. `on_hand_quantity >= 0`.
4. `reserved_quantity >= 0`.
5. `reserved_quantity <= on_hand_quantity`.
6. `available_quantity = on_hand_quantity - reserved_quantity`.
7. Every change to on-hand or reserved quantity creates an inventory movement.
8. Movement records are append-only. Corrections create a compensating movement.
9. An inventory transfer creates an outbound movement and an inbound movement in the same transaction.
10. A manager may change only inventory in an assigned warehouse.
11. Batch and expiry data are optional, but if supplied, the batch belongs to the receiving warehouse and SKU.

## 3. Warehouse selection

1. A warehouse is eligible only when it is active and can satisfy all required order lines.
2. Available quantity, not on-hand quantity, is used for checkout decisions.
3. The first release selects the warehouse using sufficient stock and a deterministic tie-breaker.
4. The tie-breaker is: highest minimum line availability, then lowest warehouse ID.
5. Distance optimization is deferred.

## 4. Reservations

1. Reservation and order creation are protected by a PostgreSQL transaction.
2. A reservation is created as `PENDING` before payment confirmation.
3. Creating a pending reservation increases `reserved_quantity`.
4. When payment and order confirmation succeed, each confirmed line atomically decreases both `on_hand_quantity` and `reserved_quantity` and creates a sale movement. The reservation then becomes `CONFIRMED` and no longer contributes to the reserved quantity.
5. Releasing or expiring a `PENDING` reservation decreases reserved quantity exactly once.
6. A reservation cannot be released twice.
7. An expired reservation cannot become confirmed.
8. Reservation expiry is handled by a repeatable job and remains safe if the job runs more than once.
9. If any line in a multi-line order cannot be reserved, all reservations for that checkout attempt are rolled back.

## 5. Orders and payments

1. An order starts as `PENDING_PAYMENT`.
2. An order becomes `PAID` only after the payment provider or mock provider confirms payment.
3. An order becomes `CONFIRMED` only when payment and reservation confirmation succeed.
4. Cancelling a confirmed order creates a compensating return/restock movement when permitted by fulfillment state; it does not attempt to release an already-confirmed reservation.
5. A shipped or delivered order cannot be cancelled through the normal customer endpoint.
6. A repeated idempotency key returns the original operation result.
7. The same idempotency key cannot be reused for a materially different request.
8. Payment credentials are handled by the payment provider; SupplySense stores references and states only.

## 6. Suppliers and purchase orders

1. A supplier-product relationship contains cost, lead time, MOQ, and pack size.
2. Lead time is a non-negative number of days; the first release requires a positive lead time for recommendations.
3. MOQ is zero or greater; pack size is a positive integer.
4. Purchase-order quantities are positive integers.
5. A received quantity cannot exceed ordered quantity unless an administrator explicitly records an over-receipt adjustment.
6. Goods receipt increases on-hand inventory and creates a receipt movement in one transaction.
7. Purchase orders are immutable in their financial history after receipt begins; corrections use adjustments.

## 7. Formula intelligence

1. Sales history is aggregated by SKU, warehouse, and business date.
2. Cancelled orders do not count as sales.
3. Returns subtract from sales where the business process records them as returned units.
4. Missing dates in the lookback window are represented as zero sales when the SKU was active.
5. A forecast is not generated when the minimum history requirement is not met; the UI shows “insufficient history”.
6. A recommendation never directly mutates inventory.
7. A recommendation must store the formula version and all values needed to reproduce it.
8. Approval creates a `DRAFT` purchase order. Submission to the supplier is a separate manager action.
9. Approval alone does not claim stock.

### Formula version `formula_v1`

For a SKU and warehouse, use a daily sales series over a 28-day lookback window. Missing dates for an active SKU are represented as zero sales.

Let:

- `D_t` = actual units sold on day `t`
- `F_t` = forecast for day `t`
- `alpha` = `0.30`
- `L` = supplier lead time in days
- `sigma` = sample standard deviation of daily demand
- `z` = `1.65` for the initial approximately 95% service target
- `available` = `on_hand_quantity - reserved_quantity`

Forecast:

```text
F_0 = average of available daily sales values in the lookback window
F_t = alpha * D_t + (1 - alpha) * F_(t-1)
forecast_daily_demand = max(0, F_t)
```

Reorder calculation:

```text
lead_time_demand = forecast_daily_demand * L
safety_stock = z * sigma * sqrt(L)
reorder_point = lead_time_demand + safety_stock
base_quantity = max(0, reorder_point - available)
```

Supplier constraints are then applied:

```text
if base_quantity > 0:
    recommended_quantity = max(MOQ, ceil(base_quantity / pack_size) * pack_size)
else:
    recommended_quantity = 0
```

If fewer than 7 observed sales days exist, store an `INSUFFICIENT_HISTORY` result rather than presenting a false precise recommendation. If `sigma` is zero, safety stock is zero until a configured minimum policy is added.

Anomaly score:

```text
z_score = (D_t - rolling_average_28d) / rolling_standard_deviation_28d
```

Flag an anomaly when `abs(z_score) >= 3`. If the standard deviation is zero, flag a spike only when `D_t >= 2 * rolling_average_28d` and the average is greater than zero.

## 8. Audit

Audit events are required for:

- Login success/failure and refresh-token revocation
- Permission denial on protected resources
- User and role changes
- Product, warehouse, supplier, and configuration changes
- Inventory adjustments, reservations, releases, transfers, and receipts
- Payment state changes, order cancellation, and refunds
- Purchase-order approval, rejection, and receipt
- Recommendation approval and rejection

Audit records must not contain passwords, refresh tokens, access tokens, payment secrets, or complete sensitive payloads.

## 9. State transitions

```text
Reservation: PENDING → CONFIRMED
Reservation: PENDING → RELEASED
Reservation: PENDING → EXPIRED

Order: PENDING_PAYMENT → PAID → CONFIRMED → PACKED → SHIPPED → DELIVERED
Order: PENDING_PAYMENT → CANCELLED
Order: CONFIRMED → CANCELLED → REFUNDED

Purchase order: DRAFT → SUBMITTED → ACCEPTED → PARTIALLY_SHIPPED
Purchase order: PARTIALLY_SHIPPED → SHIPPED → PARTIALLY_RECEIVED → RECEIVED
Purchase order: DRAFT/SUBMITTED → CANCELLED
```
