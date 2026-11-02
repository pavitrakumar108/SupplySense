# Phase 7 — Reservations and Orders

Phase 7 is complete and is backed by local PostgreSQL transactions.

## Delivered

- Checkout recalculates prices and totals from trusted database records.
- Checkout validates the active SKU state, quantity, currency, shipping address, and stock.
- Warehouse selection uses only active warehouses that can satisfy every line and applies a deterministic availability/ID tie-breaker.
- Checkout locks inventory rows, creates a `PENDING_PAYMENT` order and `PENDING` reservation, increments reserved stock, writes reservation movements, and clears the cart in one transaction.
- Reservation expiry is enforced when payment confirmation arrives.
- A repeatable local expiry worker releases overdue pending reservations and cancels unpaid pending orders safely.
- Customers, managers in assigned warehouse scope, administrators, and auditors can read only permitted orders.
- Order lines preserve SKU, product-name, unit-price, quantity, and line-total snapshots.
- Pending cancellation releases reserved stock exactly once.
- Confirmed cancellation creates compensating return movements without releasing an already-confirmed reservation.

## Routes

| Method | Route | Access |
| --- | --- | --- |
| POST | `/api/v1/checkout` | Customer; requires `Idempotency-Key` |
| GET | `/api/v1/orders` | Customer, manager, admin, or auditor |
| GET | `/api/v1/orders/:orderId` | Scoped |
| POST | `/api/v1/orders/:orderId/cancel` | Customer, manager, or admin in scope |

Checkout replay with the same key and request body returns the original order instead of creating a duplicate order or reservation. A changed request body with the same key is rejected.
