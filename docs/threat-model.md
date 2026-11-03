# SupplySense Threat Model

## 1. Assets to protect

- User accounts and password hashes
- JWT and refresh-token sessions
- Customer addresses and order history
- Product pricing and supplier costs
- Inventory quantities and reservations
- Payment references and refund state
- Purchase orders and supplier information
- Audit history
- Database credentials and application secrets

## 2. Trust boundaries

```text
Customer browser
    | untrusted input, untrusted totals, untrusted role claims
    v
Public Express API
    | validated and authorized service calls
    v
PostgreSQL / payment provider / optional Redis
```

The browser is not trusted for identity, price, warehouse, quantity, inventory, payment state, or permissions.

## 3. Threats and mitigations

| Threat | Example | Required mitigation |
|---|---|---|
| Credential theft | Password database leak | Argon2/bcrypt, strong password policy, no plaintext passwords |
| Token theft | Refresh token copied from storage | HTTP-only secure cookie, rotation, revocation, short access-token lifetime |
| Broken access control | Supplier reads another supplier's PO | Role middleware plus database scope checks and negative tests |
| Price tampering | Client submits a lower checkout total | Recalculate all amounts from database records |
| Overselling | Two customers buy the last unit | PostgreSQL transaction, row locks/conditional update, concurrency tests |
| Replay | Checkout request retried | Idempotency keys and stored operation result |
| Injection | Malformed filter or body reaches database | Schema validation, Prisma parameterization, allowlisted sorting |
| Cross-site request forgery | Cookie-backed refresh or payment action abused | Same-site cookie, CSRF strategy for cookie-authenticated state changes, origin checks |
| Cross-site scripting | Product description contains markup | Escape output, sanitize permitted rich text, restrictive content security policy |
| Denial of service | Login or search flood | Rate limiting, request size limits, pagination limits, timeouts |
| Secret leakage | Stack trace or environment value in response | Safe global error handler and secret-aware logging |
| Audit tampering | Manager edits history | Append-only audit table, restricted database permissions, no delete endpoint |
| Webhook forgery | Fake payment success callback | Provider signature verification and idempotent event handling |
| Replay of webhook | Same payment event sent repeatedly | Provider-event ID uniqueness and idempotent processing |
| Supply-chain fraud | Over-receipt without authorization | Ordered-quantity checks, receipt permissions, movement audit |
| Stale cache | Cached inventory used at checkout | PostgreSQL revalidation for all final stock decisions |

## 4. Security requirements for Phase 2

- Validate environment variables at startup.
- Use a production-grade password hash.
- Set Helmet headers and a restrictive Content Security Policy where compatible.
- Configure CORS from an allowlist, not `*` in production.
- Enforce request-body and URL size limits.
- Apply login, refresh, checkout, and webhook rate limits.
- Use generic login failure messages.
- Redact authorization headers, cookies, passwords, and payment secrets from logs.
- Use parameterized database access only.
- Add dependency auditing to CI.
- Use HTTPS in every non-local environment.
- Apply least-privilege database credentials.
- Test authorization failures as thoroughly as successful paths.

## 5. Abuse-case acceptance criteria

1. A customer cannot change an order's price by editing browser requests.
2. A manager cannot modify an unassigned warehouse using a guessed UUID.
3. A supplier cannot approve another supplier's purchase order.
4. A repeated payment webhook cannot move an order through the state machine twice.
5. A malformed request cannot expose database details.
6. An expired reservation cannot be confirmed.
7. An audit log cannot be changed through the application API.
