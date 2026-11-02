# Phase 8 — Mock Payments

Phase 8 is complete using a local mock provider. No payment credentials or external provider calls are used.

## Delivered

- Mock payment confirmation supports `success`, `failure`, and `pending` outcomes.
- Successful capture atomically decrements on-hand and reserved stock, writes sale movements, confirms the reservation, and advances the order through `PAID` to `CONFIRMED`.
- Failed payments release pending reservations exactly once and cancel the order.
- Pending mock payments can be completed through a signed local provider webhook.
- Full refunds are supported for cancelled orders and advance the order to `REFUNDED`.
- Confirmations and refunds use persisted idempotency records and replay the original response.
- Provider references and payment state are stored; payment credentials are never stored.

## Routes

| Method | Route | Access |
| --- | --- | --- |
| POST | `/api/v1/payments/:orderId/confirm` | Customer owner or admin; requires `Idempotency-Key` |
| POST | `/api/v1/payments/:orderId/refund` | Admin or assigned warehouse manager; requires `Idempotency-Key` |
| POST | `/api/v1/payments/webhook` | Signed local mock-provider callback |

The local webhook signature is an HMAC-SHA256 over the canonical JSON body using `MOCK_PAYMENT_WEBHOOK_SECRET` from `.env`.
