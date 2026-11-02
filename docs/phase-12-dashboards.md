# Phase 12: Operational dashboards

Phase 12 is implemented as local, permission-scoped dashboard APIs.

## Delivered

- Manager dashboard: stock value, low-stock count and detail, open purchase orders, critical alerts, anomalies, sales trend, and prioritized pending recommendations.
- Admin dashboard: active user/product/SKU/warehouse/supplier counts, open purchase orders, stock value, anomaly count, and recent audit activity.
- Supplier dashboard: active supplier-product count, open purchase orders, active shipments, outstanding units, and recent assigned purchase orders.
- Dashboard queries use the same manager warehouse scope and supplier account scope as the underlying workflows.

## Main endpoints

`GET /api/v1/dashboards/manager`, `GET /api/v1/dashboards/admin`, and `GET /api/v1/dashboards/supplier`.

All dashboard values are computed from local PostgreSQL records and include no remote analytics dependency.

