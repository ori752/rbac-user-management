# RBAC User Management System — Engineering Reference

## Project Overview

A production-ready Role-Based Access Control (RBAC) user and permissions management system built
with **TypeScript**, **Express 5**, **bcryptjs**, and **JWT**. The backend exposes a RESTful API;
the frontend is a single-file vanilla-JS SPA served as a static asset.

---

## Stack

| Layer      | Technology             | Notes                                        |
|------------|------------------------|----------------------------------------------|
| Runtime    | Node.js 18+            | Required for `crypto.randomUUID()` and `fetch` |
| Language   | TypeScript 6 (strict)  | `tsc --noEmit` must pass with zero errors     |
| Framework  | Express 5              | Async error propagation built in              |
| Auth       | jsonwebtoken 9         | HS256, 8-hour expiry, token versioning        |
| Passwords  | bcryptjs 3             | bcrypt, cost factor 10                        |
| Testing    | Jest 29 + ts-jest + supertest | Run `npm install` before first test run |

---

## Quick-Start Commands

```bash
# Install all dependencies (required after first clone or any package.json change)
npm install

# Start development server with hot reload
npm run dev
# → http://localhost:3000

# Type-check without emitting output
npx tsc --noEmit

# Compile TypeScript to dist/
npm run build

# Start compiled production server
npm start

# Run full test suite
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode (for development)
npm run test:watch
```

---

## Environment Variables

| Variable          | Default                     | Required in Production    |
|-------------------|-----------------------------|---------------------------|
| `PORT`            | `3000`                      | No                        |
| `JWT_SECRET`      | `dev-secret-change-in-prod` | **YES** — must be changed |
| `NODE_ENV`        | (unset)                     | Set to `production`       |
| `ALLOWED_ORIGINS` | `''` (all origins)          | Recommended               |

Create a `.env` file (gitignored) or set variables in your deployment platform.

> **Warning:** The default `JWT_SECRET` is public knowledge. Any production deployment without
> overriding it is critically insecure.

---

## Project Structure

```
src/
├── app.ts                    # Express app factory — no server.listen call
├── index.ts                  # Server entry point — imports app, calls listen
├── types/
│   └── rbac.ts               # All RBAC types, role constants, permission matrix
├── data/
│   └── store.ts              # In-memory user store + audit log
├── utils/
│   └── validation.ts         # Input validators: email, password, name, role
├── middleware/
│   ├── auth.ts               # JWT authenticate + requirePermission guards
│   ├── security.ts           # Security headers (CSP, HSTS, etc.) + CORS
│   ├── rateLimit.ts          # Sliding-window in-memory rate limiter
│   └── errorHandler.ts       # Global Express error handler + asyncHandler wrapper
├── controllers/
│   ├── authController.ts     # login, me
│   └── userController.ts     # listUsers, getUser, createUser, updateUser, deleteUser
├── routes/
│   ├── auth.ts               # POST /auth/login  GET /auth/me
│   └── users.ts              # CRUD /users and /users/:id
└── __tests__/
    ├── rbac.test.ts          # Unit tests: permission matrix, validation
    ├── auth.test.ts          # Integration tests: /auth/* endpoints
    └── users.test.ts         # Integration tests: /users/* endpoints

public/
└── index.html                # Single-file SPA (vanilla JS, no build step needed)

dist/                         # Compiled JS output (gitignored)
```

---

## RBAC Architecture

### Role Hierarchy (ascending privilege)

```
guest (0)  <  user (1)  <  manager (2)  <  admin (3)
```

The numeric value is stored in `ROLE_HIERARCHY` in `src/types/rbac.ts`. It is used to enforce
that no actor can ever assign a role whose privilege level is >= their own.

### Permission Matrix

| Permission         | admin | manager | user | guest |
|--------------------|:-----:|:-------:|:----:|:-----:|
| `users:read_all`   | ✓     | ✓       |      |       |
| `users:read_own`   | ✓     | ✓       | ✓    | ✓     |
| `users:create`     | ✓     |         |      |       |
| `users:update_any` | ✓     |         |      |       |
| `users:update_own` | ✓     | ✓       | ✓    |       |
| `users:delete`     | ✓     |         |      |       |
| `roles:assign`     | ✓     | ✓       |      |       |

### Role Assignment Rules

- **Admins** can assign any role (including `admin`).
- **Managers** can assign roles strictly below their own level (`guest`, `user`) to existing users.
  They cannot promote anyone to `manager` or `admin`.
- **Users / Guests** cannot assign roles at all.
- The `validateRoleAssignment()` helper in `src/utils/validation.ts` enforces the hierarchy check.

---

## API Reference

### Authentication

| Method | Path           | Auth | Rate Limit           |
|--------|----------------|------|----------------------|
| POST   | `/auth/login`  | No   | 10 requests / 15 min |
| GET    | `/auth/me`     | JWT  | —                    |

**Login request body:**
```json
{ "email": "admin@example.com", "password": "admin123" }
```
**Login success response:**
```json
{
  "token": "<signed-jwt>",
  "user": { "id": "...", "name": "Admin User", "email": "...", "role": "admin", "isActive": true, ... }
}
```

### Users

All user routes require `Authorization: Bearer <token>`.

| Method | Path          | Required Permission   | Additional Constraint                              |
|--------|---------------|-----------------------|----------------------------------------------------|
| GET    | `/users`      | `users:read_all`      | Admin + Manager only                               |
| GET    | `/users/:id`  | `users:read_own`      | Non-admin/manager may only fetch own ID            |
| POST   | `/users`      | `users:create`        | Admin only; role hierarchy enforced                |
| PUT    | `/users/:id`  | `users:update_own`    | Non-admin may only update own profile; role changes enforced by hierarchy |
| DELETE | `/users/:id`  | `users:delete`        | Admin only; self-delete and admin-delete forbidden |

### Health Check

```
GET /health  →  { "status": "ok", "timestamp": "<ISO-8601>" }
```

---

## Security Controls

| Control                       | Implementation                                           |
|-------------------------------|----------------------------------------------------------|
| Password hashing              | bcrypt, cost factor 10                                   |
| Token invalidation            | `tokenVersion` on User; bumped on password or role change |
| Account deactivation          | `isActive` flag checked on every authenticated request   |
| Timing-safe login             | bcrypt always runs even when the email does not exist    |
| Input validation              | `src/utils/validation.ts` — enforced on every endpoint  |
| Email normalisation           | Lower-cased before storage and comparison                |
| Rate limiting (login)         | 10 requests per 15 minutes per IP                        |
| Security headers              | X-Content-Type-Options, X-Frame-Options, CSP, HSTS, etc.|
| Privilege escalation guard    | Cannot assign role >= own level                          |
| Self-deletion prevention      | HTTP 400 returned                                        |
| Admin-account deletion guard  | Admin accounts cannot be deleted via the API             |
| XSS prevention (frontend)     | All user data is HTML-escaped before DOM injection       |
| Audit log                     | Every auth event and user mutation is recorded in-memory |

---

## Seed Accounts (Development Only)

| Email                 | Password    | Role    |
|-----------------------|-------------|---------|
| admin@example.com     | admin123    | admin   |
| manager@example.com   | manager123  | manager |
| user@example.com      | user1234    | user    |
| guest@example.com     | guest123    | guest   |

> **Never deploy with these credentials.** Seed passwords are intentionally weak for demo use only.

---

## Data Store

The current implementation uses an **in-memory Map**. All data resets on server restart.

To migrate to a persistent database:
1. Implement the same interface as `store` in `src/data/store.ts`.
2. Replace the `store` import in each controller — no other code changes required.
3. Add connection pooling, migrations, transactions, and proper error handling.

---

## Testing Strategy

### Unit Tests (`src/__tests__/rbac.test.ts`)
- Validates the entire permission matrix programmatically against `ROLE_PERMISSIONS`.
- Tests role hierarchy comparisons via `ROLE_HIERARCHY`.
- Tests every input validation function with valid inputs, boundary values, and attack strings.
- Tests the privilege-escalation guard logic.

### Integration Tests (`src/__tests__/auth.test.ts`, `src/__tests__/users.test.ts`)
- Spin up the Express `app` in-process using supertest (no real server port needed).
- Cover happy paths and every documented error case (400, 401, 403, 404, 409, 429).
- Verify HTTP status codes, response shapes, and RBAC enforcement end-to-end.

```bash
npm test                # all tests
npm run test:coverage   # with coverage report
npm run test:watch      # interactive watch mode
```

---

## Development Rules

- **Never** commit a real `JWT_SECRET`, `.env` file, or credentials.
- All new endpoints require integration test coverage before merging.
- Run `npx tsc --noEmit` locally before opening a PR — zero type errors required.
- Async controller functions must be wrapped with `asyncHandler()` from `src/middleware/errorHandler.ts`.
- Any new `Permission` type must be added to `ROLE_PERMISSIONS` in `src/types/rbac.ts` and
  documented in the permission matrix table above.
- Audit log entries (`store.addAudit(...)`) must be written for every user mutation and auth event.
- Keep business logic in controllers; routing only in `routes/`.
- No `any` types — use the shared types in `src/types/rbac.ts`.

---

## Deployment (Railway)

```bash
# Railway detects Node.js via Nixpacks and uses railway.json for build/start commands.
# Ensure the following environment variables are set in Railway:
#   JWT_SECRET=<strong-random-secret>
#   NODE_ENV=production
#   ALLOWED_ORIGINS=https://your-frontend-domain.com
```

---

## Guesty Property Pipeline (`npm run crawl`)

A standalone automation script that scrapes a property listing from Airbnb or
Booking.com, creates a draft in Guesty Sandbox, and notifies the Engineering
Manager via email and/or Slack.

### Quick start

```bash
# 1. Copy environment template and fill in credentials
cp .env.example .env

# 2. Dry-run: scrape + map + print — no Guesty API calls
npm run crawl -- --url "https://www.airbnb.com/rooms/12345678" --dry-run

# 3. Full run: scrape → create Guesty listing → notify manager
npm run crawl -- --url "https://www.airbnb.com/rooms/12345678"

# 4. Verbose debug output
npm run crawl -- --url "https://www.airbnb.com/rooms/12345678" --log-level debug

# 5. Type-check the scripts independently
npm run typecheck:scripts
```

### Pipeline stages

| Stage | Description |
|-------|-------------|
| 1. Crawl | Fetches the property page; extracts title, description, images, amenities, location |
| 2. Map | Converts `PropertyData` → `GuestyListingPayload` (type/room normalisation, address merge) |
| 3. Auth | OAuth 2.0 client-credentials token fetch from Guesty |
| 4. Create | `POST /v1/listings` — returns the new Guesty listing ID |
| 5. Pictures | `PUT /v1/listings/:id` in batches of 10; partial failures are non-fatal |
| 6. Notify | Email (SMTP) + Slack webhook + console log fired in parallel |

### CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--url <url>` | _(required)_ | Full Airbnb or Booking.com property URL |
| `--dry-run` | off | Print extracted data and Guesty payload; skip all API calls |
| `--log-level <level>` | `info` | `debug` \| `info` \| `warn` \| `error` |

### Environment variables (script-specific)

| Variable | Required | Description |
|----------|----------|-------------|
| `GUESTY_CLIENT_ID` | **YES** | Guesty sandbox OAuth client ID |
| `GUESTY_CLIENT_SECRET` | **YES** | Guesty sandbox OAuth client secret |
| `GUESTY_API_BASE` | No | Override API base URL (default: `https://open-api.guesty.com`) |
| `NOTIFY_EMAIL_TO` | For email | Recipient address (Engineering Manager) |
| `NOTIFY_EMAIL_FROM` | For email | Sender address shown in From: header |
| `SMTP_HOST` | For email | SMTP server hostname |
| `SMTP_PORT` | For email | SMTP port (587 = STARTTLS, 465 = SSL) |
| `SMTP_USER` | For email | SMTP username |
| `SMTP_PASS` | For email | SMTP password or App Password |
| `SLACK_WEBHOOK_URL` | For Slack | Incoming Webhook URL from api.slack.com |

> Copy `.env.example` to `.env` and fill in the values.  The `.env` file is
> gitignored — **never commit real credentials.**

### Script structure

```
scripts/
├── crawl-to-guesty.ts          # CLI entry point / pipeline orchestrator
├── crawler/
│   ├── types.ts                # PropertyData interface (platform-agnostic)
│   ├── airbnb.ts               # Airbnb scraper (__NEXT_DATA__ extraction)
│   ├── booking.ts              # Booking.com scraper (JSON-LD + meta tags)
│   └── index.ts                # Crawler factory (URL → correct scraper)
├── guesty/
│   ├── types.ts                # Guesty API request/response interfaces
│   ├── client.ts               # GuestyClient — auth, createListing, uploadPictures
│   └── mapper.ts               # PropertyData → GuestyListingPayload converter
├── notifier/
│   ├── types.ts                # NotificationPayload interface
│   ├── email.ts                # Nodemailer HTML email sender
│   ├── slack.ts                # Slack Block Kit webhook sender
│   └── index.ts                # Notification dispatcher (all channels in parallel)
└── utils/
    ├── logger.ts               # Structured JSON logger (stdout/stderr)
    └── retry.ts                # Exponential-backoff retry with full jitter

tsconfig.scripts.json           # Separate TS config for scripts/ (rootDir: scripts/)
.env.example                    # Template with all required variables documented
```

### Scraping limitations

- **Airbnb** embeds all page data in `<script id="__NEXT_DATA__">` as JSON.
  The extractor tries multiple known structural paths and falls back to a
  recursive deep-search.  A 403 response means Airbnb's bot-detection
  blocked the request — use a residential proxy in production.
- **Booking.com** uses Cloudflare protection.  The extractor parses JSON-LD
  (`<script type="application/ld+json">`) and Open Graph meta tags which
  survive bot-detection better than DOM scraping.  For guaranteed extraction,
  integrate a headless browser (Playwright) as an optional layer.
- Both scrapers implement 3-attempt exponential-backoff retry with full jitter
  and realistic browser headers to maximise success rate on first run.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (or dry-run completed) |
| 1 | Crawl failure |
| 2 | Guesty authentication failure |
| 3 | Guesty listing creation failure |
| 4 | Missing required CLI arguments |

### Notification channels

All three channels fire in parallel on both success and failure:

1. **Console** — always; structured JSON log lines
2. **Email** — fires when all `SMTP_*` and `NOTIFY_EMAIL_TO` vars are set;
   sends a rich HTML email with a data table and dashboard link
3. **Slack** — fires when `SLACK_WEBHOOK_URL` is set;
   posts a Block Kit card with property details and action buttons

Individual channel failures are caught and logged but do not cause the
pipeline exit code to change.
