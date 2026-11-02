# Phase 4 — Catalog and SKU Management

Phase 4 is complete and runs locally through the versioned API.

## Delivered

- Public category listing and active product catalog browsing.
- Product search by name, slug, or SKU, with category, price, sort, and pagination filters.
- Product detail responses include active variants, images, price, and aggregate available stock.
- Admin category create, update, and deactivate operations.
- Admin product create, update, and deactivate operations.
- Admin SKU create, update, and deactivate operations scoped to their product.
- Admin product image create and delete operations.
- Server-side validation for UUIDs, slugs, prices, currency codes, and bounded text fields.

## Routes

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/v1/categories` | Public |
| GET | `/api/v1/products` | Public |
| GET | `/api/v1/products/:productId` | Public |
| POST/PATCH/DELETE | `/api/v1/categories` | Admin |
| POST/PATCH/DELETE | `/api/v1/products` | Admin |
| PATCH/DELETE | `/api/v1/products/:productId` | Admin |
| POST/PATCH/DELETE | `/api/v1/products/:productId/variants` | Admin |
| POST/DELETE | `/api/v1/products/:productId/images` | Admin |

Public catalog queries never expose inactive products or variants. Availability is derived from active warehouse inventory as `onHandQuantity - reservedQuantity` and is not cached as an independent source of truth.
