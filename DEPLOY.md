# Deploying to Railway (app + live Guesty import)

This deploys the RBAC web app **and** the crawl-to-Guesty import feature (which
runs a headless Chromium browser in the container).

## How it's built
- **Dockerfile** based on `mcr.microsoft.com/playwright:v1.61.1-jammy` — ships
  Node + Chromium + all system libraries the crawl needs.
- **railway.json** is set to the `DOCKERFILE` builder (not Nixpacks, which can't
  install Playwright's system deps cleanly).
- Server is compiled (`tsc` → `dist/`) and started with `npm start`
  (`node dist/index.js`). The `/import` route spawns the crawler via `ts-node`.

## One-time deploy steps
1. **Commit & push** everything to GitHub (the `scripts/`, `Dockerfile`, etc.
   must be in the repo).
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**
   → pick this repo. Railway auto-detects the Dockerfile.
3. **Set environment variables** (Service → Variables):

   | Variable | Required | Notes |
   |---|---|---|
   | `GUESTY_CLIENT_ID` | ✅ | from your local `.env` |
   | `GUESTY_CLIENT_SECRET` | ✅ | from your local `.env` |
   | `JWT_SECRET` | ✅ | **set a long random string** (not the dev default) |
   | `NODE_ENV` | ✅ | `production` |
   | `ALLOWED_ORIGINS` | rec. | your Railway domain, for CORS |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `NOTIFY_EMAIL_TO` / `NOTIFY_EMAIL_FROM` | optional | enables real email notifications |

   > Do **not** set `PORT` — Railway injects it; the server reads `process.env.PORT`.
4. **Resources:** the crawl launches Chromium — give the service **≥1–2 GB RAM**
   (Service → Settings). The free tier may OOM during a crawl.
5. **Networking → Generate Domain** to get a public URL.
6. Open the URL, log in as admin, click **Import Property**.

## Important caveats
- **Seed accounts are weak and public.** The in-memory store seeds
  `admin@example.com / admin123`. On a public URL, anyone could log in as admin
  and trigger imports. Before sharing the URL: change the seed credentials (see
  `src/data/store.ts`) and/or restrict access. Always set a strong `JWT_SECRET`.
- **Data is in-memory** — every redeploy/restart resets users back to the seeds.
  Migrate `src/data/store.ts` to a real database for persistence.
- **Guesty token limit:** max 5 OAuth tokens per 24h per client ID. Each import
  fetches a token (no cross-process cache), so heavy use will hit the limit.
- **Bot-detection:** `--render` (headless browser) gets past Airbnb/Booking in
  most cases, but some pages/IPs may still be challenged; a residential proxy is
  the escalation.
