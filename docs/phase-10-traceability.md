# Phase 10: Tracking and traceability

Phase 10 is implemented locally with itemized shipment and receipt records.

## Delivered

- Shipment items record the exact quantity shipped for each purchase-order line.
- Partial shipments remain auditable and automatically update purchase-order status.
- Goods receipts validate the receiving warehouse and outstanding quantity.
- Every receipt atomically increases on-hand inventory, optionally records a batch/expiry date, and writes a `RECEIPT` inventory movement.
- Over-receipts, wrong-warehouse receipts, invalid transitions, and unauthorized supplier/warehouse access are rejected.
- Shipment status tracking supports shipped, in-transit, delivered, and cancelled transitions.
- SKU traceability combines inventory movements, supplier shipments, purchase orders, goods receipts, batches, and warehouses.

Goods receipt creation requires `Idempotency-Key`, so a retry cannot duplicate stock.

## Main endpoints

`POST /api/v1/purchase-orders/:purchaseOrderId/shipments`, `PATCH /api/v1/shipments/:shipmentId`, `GET /api/v1/shipments`, `POST /api/v1/purchase-orders/:purchaseOrderId/goods-receipts`, `GET /api/v1/goods-receipts`, and `GET /api/v1/traceability/:variantId`.

