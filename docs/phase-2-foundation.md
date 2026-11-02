# Phase 2 Foundation (Complete)

## Implemented

- Root npm workspace with `client` and `server` packages
- React/Vite JavaScript client shell
- Express API foundation
- Versioned `/api/v1` route boundary
- PostgreSQL Docker Compose service
- Optional Redis Docker Compose profile
- Prisma schema covering Phase 1 entities
- Prisma migration and seed scripts
- Database-level quantity and inventory-availability checks in the initial migration
- Environment parsing with Zod
- Helmet, CORS, JSON/body limits, and rate limiting
- Request IDs and structured Pino logging
- Global not-found and safe error responses
- Liveness, readiness, and dependency health endpoints
- Development seed data for roles, admin, catalog, warehouses, inventory, and supplier data
- Node.js smoke tests for health, request correlation, 404 handling, and security headers

## Start locally

1. Copy `.env.example` to `.env`.
2. Start local PostgreSQL:

   ```bash
   npm run db:local:start
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Generate Prisma Client and apply the development migration:

   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

5. Start both applications:

   ```bash
   npm run dev
   ```

The client runs at `http://localhost:5173`. The API runs at `http://localhost:4000`.

The local PostgreSQL data directory is `.local/postgres`, the service runs on port `5433`, and the data directory is ignored by version control. Docker Compose remains available as an alternative local PostgreSQL runtime.

Run `npm run check` from the repository root to validate JavaScript, execute the API smoke tests, validate the Prisma schema, and build the client without requiring a running database. The committed migration is applied with `npm run db:migrate` in development or `npm run db:deploy` in deployment environments.

## Foundation endpoints

- `GET /` - API identity
- `GET /api/v1/health/live` - process liveness; does not require PostgreSQL
- `GET /api/v1/health/ready` - readiness; requires PostgreSQL
- `GET /api/v1/health` - aggregate health with dependency status

## Phase 2 boundary

Authentication, catalog CRUD, inventory operations, carts, checkout, payment providers, supplier workflows, and formula calculations were intentionally deferred from Phase 2. The Phase 3–12 implementations now cover authentication, catalog, inventory, carts, checkout, orders, reservations, local mock payments, supplier workflows, traceability, deterministic intelligence, and dashboards.

## Local safety notes

- The seed administrator exists only for local development.
- Change `SEED_ADMIN_PASSWORD` before running the seed outside a disposable local database.
- Do not use the development JWT defaults in production.
- Do not commit `.env` or database credentials.
