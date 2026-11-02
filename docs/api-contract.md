# REST API Contract

## 1. Base conventions

- Base path: `/api/v1`
- Content type: `application/json`
- IDs: UUID strings
- Dates: ISO-8601 UTC strings
- Quantities: non-negative integers
- Money: decimal strings or minor-unit integers, chosen consistently during Phase 2
- Pagination: `page` and `pageSize`, with a maximum server-side page size
- Filtering: resource-specific query parameters
- Sorting: allowlisted fields only

## 2. Response envelope

Success:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid"
  }
}
```

Paginated success:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 100,
    "totalPages": 5,
    "requestId": "uuid"
  }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "fields": {
      "quantity": "Must be greater than zero."
    },
    "requestId": "uuid"
  }
}
```

Do not expose stack traces, SQL, JWTs, password hashes, or payment secrets.

## 3. Authentication

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Create customer account |
| POST | `/auth/login` | Public | Authenticate user |
| POST | `/auth/refresh` | Refresh cookie | Rotate refresh token and issue access token |
| POST | `/auth/logout` | Authenticated | Revoke current refresh session |
| GET | `/auth/me` | Authenticated | Return current user and roles |

## 4. Catalog and warehouse endpoints

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/categories` | Public | List active categories |
| GET | `/products` | Public | Search and paginate active products |
| GET | `/products/:productId` | Public | Product and variant details |
| POST/PATCH/DELETE | `/categories` | Admin | Category administration |
| POST/PATCH/DELETE | `/products` | Admin | Product administration |
| PATCH/DELETE | `/products/:productId` | Admin | Product administration by path |
| POST/PATCH/DELETE | `/products/:productId/variants` | Admin | SKU administration |
| POST/DELETE | `/products/:productId/images` | Admin | Product image references |
| GET | `/warehouses` | Manager/Admin | List permitted warehouses |
| POST/PATCH | `/warehouses` | Admin | Warehouse administration |
| GET | `/warehouses/:warehouseId/inventory` | Manager/Admin/Auditor | Scoped stock view |
| POST | `/warehouses/:warehouseId/inventory/adjustments` | Manager/Admin | Stock adjustment |
| POST | `/warehouses/:warehouseId/inventory/transfers` | Manager/Admin | Transfer stock |
| GET | `/warehouses/:warehouseId/movements` | Manager/Admin/Auditor | Movement history |

## 5. Customer endpoints

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET/POST/PATCH/DELETE | `/cart` | Customer | Manage current cart |
| GET/POST/DELETE | `/wishlist` | Customer | Manage wishlist |
| POST | `/checkout` | Customer | Validate, reserve, and begin payment |
| GET | `/orders` | Customer/Manager/Admin/Auditor | List permitted orders |
| GET | `/orders/:orderId` | Scoped | Order details and status history |
| POST | `/orders/:orderId/cancel` | Customer/Manager/Admin | Cancel when allowed |

## 6. Payment endpoints

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/payments/:orderId/confirm` | Customer owner/Admin | Confirm mock payment reference |
| POST | `/payments/:orderId/refund` | Admin/authorized manager | Start refund |
| POST | `/payments/webhook` | Provider signature | Receive provider event |

Payment endpoints must verify ownership, amount, provider reference, signature where applicable, and idempotency state.

## 7. Supply-chain endpoints

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/suppliers` | Manager/Admin/Auditor/Supplier scoped | List permitted suppliers |
| POST/PATCH | `/suppliers` and `/suppliers/:supplierId` | Admin | Supplier administration |
| GET | `/suppliers/:supplierId/products` | Manager/Admin/Auditor/Supplier scoped | List supplier-product relationships |
| POST/PATCH | `/suppliers/:supplierId/products` and `/suppliers/:supplierId/products/:supplierProductId` | Admin | Manage supplier-product relationships |
| GET | `/purchase-orders` | Scoped | List purchase orders |
| POST | `/purchase-orders` | Manager/Admin | Create purchase order |
| POST | `/purchase-orders/:id/submit` | Manager/Admin | Submit for supplier |
| POST | `/purchase-orders/:id/accept` | Supplier scoped | Accept purchase order |
| POST | `/purchase-orders/:id/reject` | Supplier scoped | Reject purchase order |
| POST | `/purchase-orders/:id/shipments` | Supplier scoped | Add shipment |
| GET/PATCH | `/shipments` and `/shipments/:shipmentId` | Supplier/Manager/Admin scoped | Track shipment status and tracking number |
| POST | `/purchase-orders/:id/goods-receipts` | Manager/Admin | Receive goods |
| GET | `/goods-receipts` | Manager/Admin | List receipts |
| GET | `/traceability/:variantId` | Manager/Admin/Auditor/Supplier scoped | Trace SKU movements, shipments, receipts, and batches |

## 8. Formula intelligence endpoints

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/intelligence/run` | Manager/Admin | Generate forecasts, anomalies, and recommendations |
| GET | `/analytics/forecasts` | Manager/Admin/Auditor | View forecast results |
| GET | `/analytics/sales-history` | Manager/Admin/Auditor | View daily sales history |
| GET | `/analytics/anomalies` or `/anomalies` | Manager/Admin/Auditor | View anomaly results |
| GET | `/recommendations` | Manager/Admin/Auditor | List recommendations |
| GET | `/recommendations/:id` | Scoped | View explanation and inputs |
| POST | `/recommendations/:id/approve` | Manager/Admin | Approve recommendation |
| POST | `/recommendations/:id/reject` | Manager/Admin | Reject recommendation |

## 9. Dashboards

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/dashboards/manager` | Manager/Admin/Auditor | Warehouse-scoped operational cards, trends, alerts, and recommendations |
| GET | `/dashboards/admin` | Admin/Auditor | Cross-system health and audit summary |
| GET | `/dashboards/supplier` | Supplier/Admin | Supplier-scoped orders, shipments, and outstanding units |

## 9. Idempotency

The following operations require an `Idempotency-Key` header:

- Checkout
- Payment confirmation
- Refund
- Goods receipt
- Recommendation approval when it creates a purchase order

The server stores the key, operation, authenticated user, request fingerprint, status, and response. A repeated matching request returns the stored result. A reused key with different input returns a conflict.

## 10. HTTP status policy

```text
200 successful read/update
201 resource created
202 accepted for asynchronous provider processing
204 successful operation with no body
400 malformed request
401 missing or invalid authentication
403 authenticated but not authorized
404 resource not found or intentionally hidden by scope policy
409 state conflict, stock conflict, duplicate idempotency key
422 validation/business-rule failure
429 rate limit exceeded
500 unexpected server error
```

## 11. API acceptance criteria

- Every endpoint declares required role and resource scope.
- Every write endpoint validates its body and path/query parameters.
- Checkout and goods receipt return conflict responses rather than silently changing behavior.
- Responses contain a request ID for support and audit correlation.
- The OpenAPI document produced in Phase 2 matches this contract.
