# Phase 9: Suppliers and purchase orders

Phase 9 is implemented locally in the Express API and PostgreSQL database.

## Delivered

- Supplier records and supplier-product terms: cost, currency, lead time, minimum order quantity, and pack size.
- A seeded supplier portal account (`supplier@supplysense.local`) linked to the Acme supplier record.
- Manager-scoped purchase-order creation for an assigned warehouse.
- Purchase-order state transitions: draft, submitted, accepted/rejected, cancellation, and downstream shipping/receipt states.
- Supplier-scoped purchase-order visibility and supplier acceptance/rejection.
- Audit records for supplier, purchase-order, and shipment changes.

Purchase-order quantities are validated against minimum order quantity and pack size. Unit costs are read from the supplier-product record and are not trusted from the client request.

## Main endpoints

`GET/POST /api/v1/suppliers`, `PATCH /api/v1/suppliers/:supplierId`, `GET/POST/PATCH /api/v1/suppliers/:supplierId/products`, `GET/POST /api/v1/purchase-orders`, and the purchase-order transition endpoints documented in `docs/api-contract.md`.

