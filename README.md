# SupplySense

SupplySense is a secure multi-warehouse retail and replenishment platform. Customer orders create operational data; warehouse managers use that data to make explainable replenishment decisions.

## Current status

**Core local operations complete; real payment provider configuration remains**

Phases 1 and 2 established the requirements, architecture, runnable React/Vite and Express foundation, PostgreSQL schema and migration, development seed, health checks, security middleware, structured logging, and smoke tests. Phases 3–8 provide local authentication/RBAC, a 30-product catalog, warehouse-scoped inventory, customer storefront, cart and wishlist workflows, atomic checkout reservations and orders, and mock payment confirmation/refunds/webhooks. Phases 9–12 provide supplier accounts, purchase orders, itemized partial shipments, goods receipts, traceability, sales history, deterministic intelligence, warehouse-specific dashboards, and order/shipment tracking. Phase 13 adds release verification and local deployment tooling. A real card payment provider still requires provider selection and test credentials; the local adapter is clearly labeled as mock until configured.

## Approved technology decisions

- Frontend: React, Vite, JavaScript/JSX, HTML, and CSS
- Backend: Node.js and Express.js as a feature-based modular monolith
- Database: PostgreSQL as the transactional source of truth
- ORM: Prisma
- Authentication: short-lived JWT access tokens plus rotated HTTP-only refresh tokens
- Intelligence: Node.js builds warehouse-specific sales histories and calls the Python recursive lag-7 demand predictor when there is enough recent sales data; exponential smoothing remains a fallback for explicitly selected SKUs
- Cache: Redis is optional and must never be authoritative for inventory
- Payments: mock provider first; a real provider is an integration behind the same interface
- Deployment: Docker-based services with a reverse proxy

## Product boundary

The first release includes customer commerce, warehouse-specific inventory, reservations, orders, payments, suppliers, purchase orders, goods receipt, tracking, audit logging, formula-based reorder recommendations, and Python demand prediction for warehouse sales history.

The Python predictor is a subprocess launched by the API, not a separate service. The notebook and extra model/data artifacts in `ml/` are for offline model work; the application loads `ml/artifacts/supplysense_best_model.joblib`. Kafka, microservices, and delivery-route optimization are deferred.

See the [project map and full run guide (PDF)](output/pdf/SupplySense-Project-Overview-and-Run-Guide.pdf) for the folder structure, native and Docker startup paths, and GitHub upload notes.

## Build order

1. Requirements and design
2. Project foundation and database migrations
3. Authentication and authorization
4. Catalog and SKU management
5. Warehouses and inventory
6. Cart and wishlist
7. Reservations and orders
8. Payments
9. Suppliers and supply-chain management
10. Tracking and traceability
11. Sales history and formula intelligence
12. Dashboards
13. Testing, deployment, and documentation

## Design documents

- [Requirements](docs/requirements.md)
- [Roles and permissions](docs/roles-and-permissions.md)
- [Business rules](docs/business-rules.md)
- [Architecture](docs/architecture.md)
- [Database design](docs/database-design.md)
- [API contract](docs/api-contract.md)
- [Threat model](docs/threat-model.md)
- [UI information architecture and wireframes](docs/ui-wireframes.md)
- [OpenAPI contract](docs/openapi.yaml)
- [Phase 3: Authentication and RBAC](docs/phase-3-auth.md)
- [Phase 4: Catalog and SKU management](docs/phase-4-catalog.md)
- [Phase 5: Warehouses and inventory](docs/phase-5-inventory.md)
- [Phase 6: Cart and wishlist](docs/phase-6-commerce.md)
- [Phase 7: Reservations and orders](docs/phase-7-orders.md)
- [Phase 8: Payments](docs/phase-8-payments.md)
- [Phase 9: Suppliers and purchase orders](docs/phase-9-supply-chain.md)
- [Phase 10: Tracking and traceability](docs/phase-10-traceability.md)
- [Phase 11: Sales history and intelligence](docs/phase-11-intelligence.md)
- [Phase 12: Dashboards](docs/phase-12-dashboards.md)
- [Phase 13: Release, deployment, and verification](docs/phase-13-release.md)

## Phase 1 exit condition

Phase 1 is complete when the documents above are agreed, the Phase 2 team can create the database schema and API without inventing business rules, and the acceptance criteria in `docs/requirements.md` are testable.

## Run fully locally (native development)

From the repository root:

```bash
cp .env.example .env
npm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r ml/requirements.txt
npm run db:local:start
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Open `http://localhost:5173` for the client. The API is at `http://localhost:4000`; the Vite client proxies `/api` to it. Keep `npm run dev` running. In a second terminal, run:

```bash
npm run verify:local
npm run test:e2e
```

`npm run check` validates JavaScript, runs the 12 unit/smoke tests, validates Prisma, and builds the client. `npm run verify:local` additionally checks the running API and local PostgreSQL readiness. The end-to-end test covers the supplier-to-receipt-to-intelligence-to-dashboard flow.

Demo credentials are seeded locally: `admin@supplysense.local` / `ChangeMe!12345`, `customer@supplysense.local` / `Customer!12345`, `manager@supplysense.local` / `Manager!12345`, `auditor@supplysense.local` / `Auditor!12345`, and `supplier@supplysense.local` / `Supplier!12345`.

The local PostgreSQL data directory is the ignored `.local/postgres` directory on port `5433`. Use `npm run db:local:status`, `npm run db:status`, and `npm run db:local:stop` to inspect or stop it.

### Email verification and Google sign-in

New email/password accounts must verify a one-time code before they can sign in. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM` in `.env` to deliver codes. Signup is blocked until SMTP is configured; OTPs are never returned to the browser. Set a private random `OTP_SECRET` before deploying.

To enable Google sign-in, create a Google OAuth web client, add the local and deployed site origins to its authorized JavaScript origins, then set its client ID as both `GOOGLE_CLIENT_ID` in the API environment and `VITE_GOOGLE_CLIENT_ID` in `client/.env.local`. The API verifies the Google ID token before creating a customer account. See Google's [ID token verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

The email verification and feedback tables are added by the latest Prisma migration. Apply it with `npm run db:deploy` before starting an existing database.

## Run the complete local Docker stack

If Docker Desktop is installed, the complete API, client, and PostgreSQL stack can run locally with:

```bash
npm run docker:up
```

The Docker stack is available at `http://localhost:5173`; it applies migrations and seeds the local demo data before starting the API. Stop it without deleting its database volume with:

```bash
npm run docker:down
```

## Deploy publicly for free

The included [`render.yaml`](render.yaml) deploys the built React site and Express API together as one public Render web service. PostgreSQL is hosted separately on Neon so the app's data persists when the free web service sleeps.

1. Create a free PostgreSQL project in [Neon](https://neon.tech/) and copy its pooled connection string.
2. Push this repository to GitHub.
3. In [Render](https://render.com/), create a **Blueprint** from the GitHub repository and use the committed `render.yaml`.
4. When Render prompts for `DATABASE_URL`, paste the Neon connection string. Also set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM` to your mail provider's values; for Gmail, use `smtp.gmail.com` and set `EMAIL_FROM` to the same Gmail sender address. Set `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` to the OAuth web client ID, and add the deployed HTTPS origin to that client's authorized JavaScript origins. Render generates the JWT, webhook, OTP, and six seeded-account passwords.
5. After deployment, open the public `onrender.com` URL shown in Render. Admin IDs are `admin@supplysense.local`, `admin2@supplysense.local`, and `admin3@supplysense.local`; manager IDs are `manager@supplysense.local`, `manager2@supplysense.local`, and `manager3@supplysense.local`. Retrieve their generated passwords from the Render service's environment settings and keep them private.

The free Render service sleeps after 15 minutes without traffic and may take about a minute to wake when someone visits. Free hosting is suitable for a demo, but not a reliable always-on store; Neon and Render free-plan quotas and retention limits also apply. The app currently uses mock payments, so checkout does not charge real cards.

The current API Docker image does not include the Python runtime and `ml/` files, so demand prediction requires the native development setup above.
