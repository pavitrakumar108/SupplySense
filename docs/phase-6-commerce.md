# Phase 6 — Cart and Wishlist

Phase 6 is complete and runs entirely through the local API.

## Delivered

- Customer-only cart and wishlist access with JWT/RBAC enforcement.
- Add, update, and remove cart items by SKU.
- Add and remove wishlist items by SKU.
- Duplicate cart lines are merged safely, with a maximum of 1000 units per SKU.
- Only active products and active SKUs can be added.
- Cart responses include server-side prices, line totals, subtotal, and aggregate available quantity.
- Wishlist responses include current catalog and availability details.
- Cart and wishlist changes are audit logged.

## Routes

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/v1/cart` | Customer |
| POST | `/api/v1/cart` | Customer |
| PATCH | `/api/v1/cart` | Customer |
| DELETE | `/api/v1/cart` | Customer |
| GET | `/api/v1/wishlist` | Customer |
| POST | `/api/v1/wishlist` | Customer |
| DELETE | `/api/v1/wishlist` | Customer |

Cart changes do not reserve inventory. Stock is reserved atomically during checkout in Phase 7.
