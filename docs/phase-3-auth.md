# Phase 3 — Authentication and RBAC

Phase 3 is complete and runs entirely against the local Express API and local PostgreSQL database.

## Delivered

- Customer registration creates a customer role, cart, and wishlist.
- Login issues a short-lived JWT access token and an HTTP-only refresh cookie.
- Refresh rotates the stored refresh-token hash and revokes the previous session.
- Logout revokes the current refresh session and clears the cookie.
- `GET /api/v1/auth/me` returns the authenticated user and role assignments.
- Admin-only user listing and management is available under `/api/v1/users`.
- Warehouse managers are scoped through `ManagerWarehouse` assignments.
- Protected actions write audit events, including denied permission checks.

## Routes

| Method | Route | Access |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Public customer registration |
| POST | `/api/v1/auth/login` | Public |
| POST | `/api/v1/auth/refresh` | Refresh cookie |
| POST | `/api/v1/auth/logout` | Authenticated |
| GET | `/api/v1/auth/me` | Authenticated |
| GET/POST | `/api/v1/users` | Admin |
| PATCH | `/api/v1/users/:userId` | Admin |
| PATCH | `/api/v1/users/:userId/roles` | Admin |
| PATCH | `/api/v1/users/:userId/warehouses` | Admin |

## Local verification

```bash
npm run db:local:start
npm run db:deploy
npm run db:seed
npm run dev
```

Seed credentials are controlled by the `SEED_*_PASSWORD` values in the local `.env`. Tokens and refresh sessions are stored only in the local database.
