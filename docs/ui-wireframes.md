# UI Information Architecture and Wireframes

The first release uses one React application with role-aware layouts. The UI is a client for the REST API; it does not duplicate authorization or business calculations.

## 1. Route map

### Public/customer

```text
/
├── /products
├── /products/:productId
├── /categories/:categoryId
├── /cart
├── /wishlist
├── /checkout
├── /orders
├── /orders/:orderId
├── /login
└── /register
```

### Warehouse manager

```text
/manager
├── /inventory
├── /warehouses
├── /movements
├── /recommendations
├── /anomalies
├── /purchase-orders
└── /reports
```

### Supplier

```text
/supplier
├── /purchase-orders
├── /shipments
└── /products
```

### Administrator/auditor

```text
/admin/users
/admin/products
/admin/warehouses
/admin/suppliers
/admin/audit-logs
```

## 2. Shared layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Logo │ Search │ Role-aware navigation │ Notifications │ User  │
├───────────────┬──────────────────────────────────────────────┤
│ Sidebar       │ Page title                                    │
│               │ Breadcrumbs                                   │
│               │ Main content                                  │
│               │                                                │
└───────────────┴──────────────────────────────────────────────┘
```

On small screens, the sidebar becomes a menu drawer and wide tables provide a deliberate horizontal-scroll treatment or a card layout.

## 3. Customer product page

```text
┌──────────────────────────────────────────────────────────────┐
│ Breadcrumbs                                                   │
├──────────────────────┬───────────────────────────────────────┤
│ Product image         │ Product name                          │
│                      │ Description                            │
│                      │ Variant selectors                       │
│                      │ Price                                   │
│                      │ Availability summary                    │
│                      │ Quantity  [-] 1 [+]  Add to cart       │
│                      │ Add to wishlist                         │
└──────────────────────┴───────────────────────────────────────┘
```

The customer sees availability information, not internal warehouse-sensitive details unless the product policy explicitly allows it.

## 4. Checkout page

```text
┌──────────────────────────────────────────────────────────────┐
│ Checkout                                                     │
├──────────────────────────────┬───────────────────────────────┤
│ Delivery address              │ Order summary                 │
│ Contact information            │ Item lines                    │
│ Delivery option                │ Subtotal                     │
│ Payment method                 │ Shipping                     │
│                              │ Total                         │
│ [Place order]                 │ Reservation timer             │
└──────────────────────────────┴───────────────────────────────┘
```

The reservation timer is informational. The backend remains authoritative about expiry.

## 5. Manager dashboard

```text
┌──────────────────────────────────────────────────────────────┐
│ Warehouse selector │ Date range │ Run calculations            │
├──────────────┬──────────────┬──────────────┬─────────────────┤
│ Stock value  │ Low stock    │ Open POs     │ Critical alerts │
├──────────────┴──────────────┴──────────────┴─────────────────┤
│ Demand / inventory trend chart                                │
├──────────────────────────────────────────────────────────────┤
│ Reorder recommendations                                       │
│ SKU │ Available │ Forecast │ Lead time │ Qty │ Priority │ Act │
└──────────────────────────────────────────────────────────────┘
```

Recommendation details must show the formula inputs and explanation before approval.

## 6. Inventory screen

Required columns:

- SKU
- Product name
- On hand
- Reserved
- Available
- Reorder point
- Warehouse
- Last movement
- Actions

Actions must be permission-aware and must show confirmation dialogs for adjustments, transfers, and receipts.

## 7. Recommendation detail screen

```text
Recommendation status: PENDING
SKU / Product / Warehouse

Forecasted daily demand: ...
Lead time: ... days
Lead-time demand: ...
Safety stock: ...
On hand: ...
Reserved: ...
Available: ...
Recommended quantity: ...
Formula version: ...
Reason: ...

[Approve] [Reject]
```

## 8. UI states required for every data screen

- Loading state
- Empty state
- Validation error
- Authorization error
- Network error with retry
- Successful mutation confirmation
- Destructive-action confirmation
- Pagination boundary state

## 9. Accessibility and interaction rules

- Every form control has a visible or programmatic label.
- Keyboard focus is visible.
- Status is not communicated by color alone.
- Tables have headings and responsive fallbacks.
- Error messages identify the field and corrective action.
- Modals trap focus and close predictably.
- Charts have text summaries or accessible tables.
