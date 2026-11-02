# SupplySence Requirements

## 1. Document purpose

This document freezes the Phase 1 product scope and acceptance criteria for the first production-capable release. It is the product source of truth; implementation details may change only if the behavior defined here remains intact.

## 2. Problem statement

Retail stock is split across warehouses, while customer demand and supplier replenishment are managed separately. SupplySence connects customer transactions, warehouse inventory, suppliers, and deterministic demand calculations so a manager can decide what to reorder and why.

## 3. Goals

1. Sell products without overselling stock.
2. Maintain accurate stock independently for every SKU and warehouse.
3. Record an auditable history of every inventory movement and critical action.
4. Support supplier replenishment from recommendation through goods receipt.
5. Produce explainable demand, anomaly, and reorder information without an ML service.
6. Enforce role and warehouse boundaries on every protected operation.

## 4. Actors

| Actor | Primary responsibility |
|---|---|
| Customer | Browse products, manage cart, place and track orders |
| Warehouse manager | Manage assigned warehouses, inventory, receipts, recommendations, and purchase orders |
| Supplier | Manage supplied products and respond to assigned purchase orders |
| Administrator | Manage the complete platform configuration and users |
| Auditor | Read operational and security history without changing business data |

## 5. Scope

### In scope

- Authentication, user profiles, roles, and access control
- Products, categories, variants/SKUs, prices, and images
- Multiple warehouses and warehouse-specific inventory
- Inventory adjustments, receipts, transfers, returns, and movement history
- Shopping carts and wishlists
- Warehouse selection, stock reservation, checkout, orders, and order status
- Payment abstraction, mock payments, idempotency, and refunds
- Suppliers, supplier catalogs, purchase orders, shipments, and goods receipts
- SKU, batch, shipment, and movement tracking
- Daily sales history
- Exponential-smoothing demand forecast
- Statistical anomaly detection
- Safety-stock and reorder recommendations
- Recommendation approval/rejection
- Audit logs, security controls, tests, Docker deployment, and documentation

### Out of scope for the first release

- Machine-learning model training or inference
- Python/FastAPI service
- Kafka or RabbitMQ
- Microservice decomposition
- Automated purchase-order approval
- Automated delivery-route optimization
- Marketplace or multi-tenant billing
- Storing payment-card data

## 6. Core user journeys

### U1: Customer purchase

1. Customer signs in.
2. Customer browses a product and chooses a SKU.
3. Customer adds the SKU to the cart.
4. Customer submits checkout with an idempotency key.
5. Backend finds a warehouse with enough available stock.
6. Backend reserves all order lines inside a PostgreSQL transaction.
7. Payment is authorized.
8. Order is confirmed and the reservation becomes confirmed.
9. Customer sees the order and its status.

If payment fails, the reservation is released. If any line cannot be reserved, no order is confirmed.

### U2: Manager receives stock

1. Manager opens an approved purchase order.
2. Manager records the received quantity and optional batch information.
3. Backend creates a goods receipt and inventory movement.
4. Warehouse on-hand quantity increases.
5. Purchase-order and shipment status are updated.

### U3: Manager reviews a recommendation

1. Manager opens the recommendation dashboard.
2. Backend displays forecast, lead time, safety stock, available stock, and formula version.
3. Manager approves or rejects the recommendation.
4. Approval creates a draft or submitted purchase order according to the configured workflow.
5. The decision is written to the audit log.

### U4: Supplier fulfills an order

1. Supplier sees only purchase orders assigned to that supplier.
2. Supplier accepts or rejects the order.
3. Supplier records shipment details and tracking number.
4. Warehouse manager records the goods receipt.

### U5: Administrator configures the system

1. Administrator creates users, products, warehouses, suppliers, and relationships.
2. Administrator assigns manager warehouse scopes.
3. All critical changes are audit logged.

## 7. Functional requirements

### Identity and access

- **FR-AUTH-01:** A user can register with a unique email address and password.
- **FR-AUTH-02:** A user can sign in and receive an access token through the approved token flow.
- **FR-AUTH-03:** Passwords are never stored in plaintext.
- **FR-AUTH-04:** Protected endpoints require authentication.
- **FR-AUTH-05:** Protected actions require the appropriate role and, for managers/suppliers, resource scope.
- **FR-AUTH-06:** A user can revoke their refresh sessions by logging out.

### Catalog

- **FR-CAT-01:** An administrator can create and edit categories, products, variants, prices, and image references.
- **FR-CAT-02:** A customer can list, search, filter, sort, and view active products.
- **FR-CAT-03:** Every sellable variant has a unique SKU.
- **FR-CAT-04:** Product and price information shown at checkout is recalculated server-side.

### Warehouses and inventory

- **FR-INV-01:** A SKU can have a separate inventory row in each warehouse.
- **FR-INV-02:** Inventory is uniquely identified by `(warehouse_id, variant_id)`.
- **FR-INV-03:** A manager can adjust, receive, transfer, and review inventory only within assigned warehouses.
- **FR-INV-04:** Every stock change creates an immutable movement record.
- **FR-INV-05:** Available quantity is never negative.
- **FR-INV-06:** The system supports optional batch, lot, and expiry information.

### Cart, reservations, and orders

- **FR-ORDER-01:** A customer can add, update, and remove active SKUs in a cart.
- **FR-ORDER-02:** Checkout validates price, quantity, product state, address, and stock on the server.
- **FR-ORDER-03:** Checkout reserves stock atomically and prevents overselling under concurrent requests.
- **FR-ORDER-04:** Reservations expire and release stock when payment or confirmation does not complete.
- **FR-ORDER-05:** An order stores immutable line-item snapshots.
- **FR-ORDER-06:** Customers can view only their own orders.

### Payments

- **FR-PAY-01:** The backend calculates the final amount from trusted database values.
- **FR-PAY-02:** The payment workflow accepts an idempotency key.
- **FR-PAY-03:** Repeating the same idempotent request does not create a duplicate order or charge.
- **FR-PAY-04:** Payment failures and refunds update the order and reservation consistently.

### Supply chain

- **FR-SCM-01:** Suppliers can be associated with supplied variants, cost, lead time, MOQ, and pack size.
- **FR-SCM-02:** Managers can create and submit purchase orders.
- **FR-SCM-03:** Suppliers can update only their assigned purchase orders and shipments.
- **FR-SCM-04:** Goods receipt increases inventory only for the receiving warehouse.
- **FR-SCM-05:** Partial shipment and partial receipt are supported.

### Formula intelligence

- **FR-INT-01:** The system aggregates valid sales by SKU, warehouse, and business date.
- **FR-INT-02:** The system calculates a demand forecast using the approved deterministic formula.
- **FR-INT-03:** The system calculates anomaly scores using a rolling statistical rule.
- **FR-INT-04:** The system calculates reorder quantity using demand, lead time, safety stock, available stock, MOQ, and pack size.
- **FR-INT-05:** A recommendation stores the inputs and formula version used to produce it.
- **FR-INT-06:** A manager can approve or reject a recommendation; approval creates a draft purchase order and does not submit it automatically.

### Audit and reporting

- **FR-AUD-01:** Login, permission failures, inventory changes, order decisions, payment state changes, purchase-order decisions, and recommendation decisions are logged.
- **FR-AUD-02:** Audit records identify actor, action, resource, timestamp, outcome, and request correlation ID.
- **FR-AUD-03:** Auditors can read audit records but cannot modify or delete them.

## 8. Non-functional requirements

- **NFR-01 Consistency:** PostgreSQL transactions protect inventory, reservation, order, and payment state changes.
- **NFR-02 Security:** The API uses validation, least privilege, secure headers, CORS restrictions, rate limiting, safe errors, and secret management.
- **NFR-03 Observability:** Requests have correlation IDs and structured logs; health checks expose dependency status without secrets.
- **NFR-04 Performance target:** Paginated catalog reads should remain responsive under normal demo load; checkout prioritizes correctness over cache speed.
- **NFR-05 Accessibility:** Customer and manager interfaces support keyboard navigation, visible focus, labels, readable contrast, and useful error messages.
- **NFR-06 Maintainability:** Domain rules live in services, not route handlers; database access is isolated behind repositories.
- **NFR-07 Recoverability:** Production PostgreSQL has scheduled backups and documented restore steps.
- **NFR-08 Privacy:** The system stores only the user and payment information required to operate the product.

## 9. Phase 1 acceptance criteria

- All actors, workflows, roles, and boundaries are documented.
- All critical state transitions have defined statuses.
- The inventory invariant and reservation behavior are unambiguous.
- The formula inputs and outputs are deterministic and testable.
- The Phase 2 implementation can create migrations and routes without inventing behavior.
