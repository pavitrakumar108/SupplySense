# Roles and Permissions

## 1. Roles

| Role | Scope |
|---|---|
| CUSTOMER | Own profile, cart, wishlist, and orders |
| SUPPLIER | Own supplier profile, supplied variants, assigned purchase orders, and shipments |
| WAREHOUSE_MANAGER | Assigned warehouses and related inventory, receipts, recommendations, and purchase orders |
| ADMIN | All platform resources and configuration |
| AUDITOR | Read-only access to operational and audit history |

## 2. Permission vocabulary

Permissions use the format `resource:action`.

| Resource | Permissions |
|---|---|
| auth | `auth:register`, `auth:login`, `auth:logout` |
| users | `users:read`, `users:write`, `users:assign-roles` |
| catalog | `catalog:read`, `catalog:write` |
| warehouses | `warehouses:read`, `warehouses:write` |
| inventory | `inventory:read`, `inventory:adjust`, `inventory:receive`, `inventory:transfer` |
| carts | `cart:read`, `cart:write` |
| wishlists | `wishlist:read`, `wishlist:write` |
| orders | `orders:create`, `orders:read-own`, `orders:read-scoped`, `orders:update-status`, `orders:cancel` |
| payments | `payments:create`, `payments:read`, `payments:refund` |
| suppliers | `suppliers:read`, `suppliers:write` |
| purchase orders | `purchase-orders:read`, `purchase-orders:create`, `purchase-orders:update`, `purchase-orders:approve` |
| tracking | `tracking:read`, `tracking:write` |
| intelligence | `intelligence:read`, `intelligence:run`, `recommendations:approve`, `recommendations:reject` |
| audit | `audit:read` |

## 3. Role matrix

| Capability | Customer | Supplier | Manager | Admin | Auditor |
|---|---:|---:|---:|---:|---:|
| Browse active catalog | Yes | Yes | Yes | Yes | Yes |
| Manage catalog | No | No | No | Yes | No |
| Manage own cart/wishlist | Yes | No | No | No | No |
| Create own order | Yes | No | No | Optional support only | No |
| Read own orders | Yes | No | No | Yes | Yes |
| Read assigned warehouse data | No | No | Yes | Yes | Yes |
| Adjust/receive/transfer inventory | No | No | Yes | Yes | No |
| Manage suppliers | No | No | No | Yes | No |
| Create purchase orders | No | No | Yes | Yes | No |
| Update assigned purchase orders | No | Yes, own only | Yes, assigned scope | Yes | No |
| Run formula calculations | No | No | Yes | Yes | No |
| Approve recommendations | No | No | Yes | Yes | No |
| Read audit logs | No | No | No | Yes | Yes |

## 4. Scope enforcement rules

1. Role checks run before the controller.
2. Resource scope checks run inside the service/repository query as well; hiding a UI link is not authorization.
3. A manager can access a warehouse only if an active manager-warehouse assignment exists.
4. A supplier can access a purchase order only if it belongs to that supplier.
5. A customer can access an order only if it belongs to that customer.
6. Administrators bypass business-resource scope but remain subject to validation and audit logging.
7. Auditors cannot use write endpoints, even if a write request is technically well formed.

## 5. Authorization acceptance tests

- A customer requesting another customer's order receives `403` or an equivalent safe authorization response.
- A supplier requesting another supplier's purchase order receives a safe authorization response and no data.
- A manager querying an unassigned warehouse receives no inventory data.
- A user with a valid JWT but insufficient permission cannot call a protected write operation.
- Every denied critical action is logged without recording secrets or raw tokens.
