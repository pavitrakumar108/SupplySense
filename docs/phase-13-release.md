# Phase 13: Release, deployment, and verification

The local release includes the customer ordering portal, 30-product catalog, per-warehouse workspace, order/shipment tracking, local PostgreSQL, and repeatable verification. Real card payment remains an external-provider configuration step.

## Delivered

- Native local PostgreSQL helper with committed migration deployment and repeatable seed data.
- Complete automated validation through `npm run check`.
- Deterministic formula tests and a repeatable phase 9–12 end-to-end test.
- `npm run verify:local` for API liveness, API identity, PostgreSQL readiness, migration status, and local database status.
- Root API Dockerfile with Prisma generation, migration deployment, seed, health check, and startup.
- Production-built React client container served by Nginx with `/api` reverse proxy and SPA fallback.
- Docker Compose health-gated startup for PostgreSQL → API → client.
- Local-only credentials and deployment instructions documented in the root README.
- Customer storefront with registration/login, live catalog, cart, checkout address capture, and order status timeline.
- Manager/admin workspace with warehouse selection, inventory, stock metrics, shipment tracking, customer orders, and inventory movement history.

## Release checks

From the repository root:

```bash
npm install
npm run check
npm run db:local:start
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

With the API running in another terminal:

```bash
npm run verify:local
npm run test:e2e
```

For Docker Desktop:

```bash
npm run docker:up
```

The Docker stack uses its own named PostgreSQL volume and host port `5432`; the native helper uses `.local/postgres` and port `5433`. They are separate local options and should not be started together if their API/client host ports are occupied.

## Payment boundary

The current checkout uses the existing local mock payment adapter so all ordering and inventory transactions can be tested offline. A real card flow cannot be entirely local: configure a provider such as Stripe or Razorpay with test credentials, a client publishable key, and a signed webhook endpoint before enabling live-provider capture. Do not collect raw card numbers in the SupplySence API.

## Production boundary

The Docker configuration is deliberately local/demo-ready. Before any non-local deployment, replace all seeded passwords and development secrets, enable HTTPS, configure backups and restore testing, and place the API behind an appropriate production reverse proxy.
