# Phase 5 — Warehouses and Inventory

Phase 5 is complete and is backed by the local PostgreSQL transaction store.

## Delivered

- Admin warehouse create and update operations.
- Admin access to all active warehouses; managers see only assigned warehouses.
- Inventory list pagination with SKU filtering and low-stock filtering.
- Transactional positive and negative inventory adjustments.
- Transactional warehouse transfers with paired inbound/outbound movement records.
- Movement history with variant and movement-type filters.
- Available-stock checks prevent sales-like reductions or transfers from consuming reserved stock.
- Inventory rows are locked during mutations, and movement records capture before/after quantities, actor, reason, and reference metadata.
- Audit events are recorded for warehouse creation/update, adjustments, transfers, and denied access.

## Routes

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/v1/warehouses` | Admin or warehouse manager |
| POST/PATCH | `/api/v1/warehouses` | Admin |
| GET | `/api/v1/warehouses/:warehouseId/inventory` | Admin, manager in scope, or auditor |
| POST | `/api/v1/warehouses/:warehouseId/inventory/adjustments` | Admin or manager in scope |
| POST | `/api/v1/warehouses/:warehouseId/inventory/transfers` | Admin or manager with source and target scope |
| GET | `/api/v1/warehouses/:warehouseId/movements` | Admin, manager in scope, or auditor |

## Invariants

- `reservedQuantity` cannot exceed `onHandQuantity`.
- Available quantity cannot become negative.
- Negative adjustments cannot create negative batch quantities.
- Transfers require distinct active warehouses and sufficient available source stock.
- Warehouse-manager scope is checked before every warehouse-specific read or mutation.
