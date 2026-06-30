# Changelog

All notable changes to this project are documented here.
Format is based on [Keep a Changelog](https://keepachangelog.com/); the project
uses semantic-style versioning.

## [Unreleased] — legal data-source adapters (Guesty + Playwright demo)

### Playwright scraping demo (`--source mock`)

- A legal, end-to-end demonstration of the same skill stack the project targets
  (browser automation → DOM extraction → LLM analysis → ranked report), with NO
  third-party scraping, proxies, or anti-bot evasion:
  - `fixtures/build-mock-site.ts` generates a realistic rental "marketplace"
    (static HTML) from the sample data.
  - `sources/mockScrape.ts` serves it locally over HTTP and drives **real
    headless Chromium** to crawl the index and scrape each listing's title,
    rating, reviews, and host **business** contact from the rendered DOM, then
    feeds the existing analyzer → distress → report → notify pipeline.
  - Repoint at any source you're permitted to scrape (a scraping sandbox or a
    licensed feed) without changing the rest of the pipeline.

### Guesty portfolio-health source

- **Guesty listing source** (`--source guesty` / `LEADS_SOURCE=guesty`): pulls
  your own listings via the **official Guesty Open API** (OAuth, reusing the
  existing `GuestyClient` — authorized account data, no scraping/proxies/OSINT).
- **Portfolio-health scoring** (`health.ts`): because Guesty holds the properties
  you *manage*, the engine scores **operational facts from your own account** —
  unpublished (`isListed:false`), inactive (`active:false`), and stale "dirty"
  housekeeping — to flag managed listings that need attention. `DistressScore.basis`
  gains `'operational_pms_data'` to distinguish this from the public-review
  inference path; the report carries a `PORTFOLIO_DISCLAIMER`.
- `LEADS_SOURCE` env selects the default source for the CLI and the web "Run
  pipeline" button. +7 tests (143 total).

## [1.4.0] — Host Lead Intelligence (B2B host-prospecting module)

A pluggable pipeline that surfaces **struggling short-term-rental hosts**
(property owners / commercial operators) as qualified B2B leads for a
property-management company. The lead is always the **host/owner** — guests who
wrote reviews are never profiled or identified. See
[`docs/host-lead-intelligence.md`](docs/host-lead-intelligence.md) for the
manager-facing compliance & data-sourcing note.

### Added

**Phase A — sources & CLI**
- `ListingSource` interface with a **fixture adapter as the default** (zero
  scraping, zero cost) and a documented **partner-API stub** for connecting a
  compliant source later. Source selected via `selectSource(name)`.
- `npm run leads` CLI (`scripts/prospecting/run.ts`) with `--source`, `--limit`,
  `--json`.
- Compliance posture encoded **in the types**: `PublicReview` has no
  author/reviewer field; `HostBusinessContact` carries business contact only (no
  personal address, personal social, or username fields).

**Phase B — analysis & scoring**
- `ReviewAnalyzer` with two implementations: a deterministic
  `HeuristicReviewAnalyzer` (default, offline) and a `ClaudeReviewAnalyzer`
  (Anthropic SDK, structured outputs via `messages.parse()` + `zodOutputFormat`,
  model from `LEADS_MODEL`, default `claude-sonnet-4-6`). `selectAnalyzer()` uses
  Claude only when `ANTHROPIC_API_KEY` is set, else falls back to heuristic — and
  the Claude analyzer itself falls back to heuristic on any error.
- `computeDistress()` → a 0–100 **delisting-risk inference** from public review/
  rating signals only, labeled `basis: 'inference_from_public_data'`.

**Phase C — report & notification**
- `buildLeadsReport()` ranks hosts by distress and applies a **qualified-lead
  floor** (`LEADS_MIN_DISTRESS`, default 40); the report is **never padded** to 5
  with healthy hosts and states plainly when fewer qualify.
- `LEADS_DISCLAIMER` (the inference disclaimer) is carried on **every surface** —
  the JSON report, the human-readable summary, and the manager notification.
- Manager notification via a generic report channel reusing the existing email/
  Slack transports; console always fires.

**Phase D — RBAC-gated web surface**
- Two new permissions: **`leads:read`** (admin + manager) and **`leads:run`**
  (admin only). Added to `ROLE_PERMISSIONS` and the RBAC contract test. No route
  or UI element gates on a raw role string.
- `GET /leads` (`leads:read`) returns the latest report JSON, or a 200
  empty-state when none exists. `POST /leads/run` (`leads:run`) triggers the
  pipeline as a child process and returns the fresh report.
- A single in-process run-lock prevents concurrent runs and is **always released
  in a `finally` block**, so a failed/crashed run can never wedge the endpoint at
  HTTP 409.
- RBAC-gated **"Leads" page** in the SPA: nav + page shown only with
  `leads:read` (invisible to user/guest); the **Run** button shown only with
  `leads:run` (admin only). Ranked lead cards + the disclaimer are rendered
  straight from the report JSON.

### Security

- `requirePermission` now resolves the caller's **current role from the store**,
  not the JWT role claim. A stale or forged token cannot grant a permission, and
  a role change takes effect on the next request (defense-in-depth atop the
  existing `tokenVersion` invalidation).
- `safeUrl()` allowlists URL schemes before any externally-sourced URL is placed
  in an `href` (HTML-entity escaping alone does not neutralize a `javascript:`/
  `data:` scheme, and the CSP uses `script-src 'unsafe-inline'`). Applied to the
  Leads "Open listing" link and the Guesty/Properties/notification links.

### Tests

- 124 → **136** tests, all green: RBAC permission split (`leads:read`
  admin+manager, `leads:run` admin-only); `/leads` integration (per-role
  401/403/200, the 409-while-running case, and the failed-run **lock-release**
  guarantee); report ranking / qualified-lead floor / disclaimer presence;
  `selectAnalyzer` selection both with and without an API key.

### Config

- `.env.example`: `ANTHROPIC_API_KEY`, `LEADS_MODEL` (default
  `claude-sonnet-4-6`), `LEADS_MIN_DISTRESS` (default 40), and a commented
  `LEADS_PARTNER_API_KEY` for a future compliant source.
- `scripts/prospecting/output/` (generated reports) is gitignored.

## [1.3.0] — RBAC-aware UI & UX polish

Made the product feel finished without weakening any backend security property.
The UI's authorization decisions are driven entirely by the permissions array the
API returns (`can(permission)`), which is locked to `ROLE_PERMISSIONS` by a
contract test — the UI can never silently drift from the backend.

### Added

**Phase 1 — permissions as the UI's source of truth**
- `/auth/login` and `/auth/me` now return the user's `permissions` array (exactly
  `ROLE_PERMISSIONS[role]`). Permissions stay **out of the JWT** (token remains
  role-based; `tokenVersion` still handles invalidation). Contract test locks the
  match and guards against drift.

**Phase 2 — role-aware UI gating**
- Every action/control is shown via `can(permission)` instead of guessing from the
  role string. Removed an internal UUID leak from the UI.

**Phase 3 — role-aware dashboard & states**
- Directory-wide stats and the user table appear only for roles that can read all
  users; other roles see a focused "Your Access" panel. Added loading skeletons
  and empty states.

**Phase 4 — secure self-service & notifications**
- Password change requires the **current password**; role-scoped in-app
  notifications; assorted action polish.

**Phase 5 — accessibility & responsive**
- **Responsive layout**: the fixed sidebar collapses to a scrollable horizontal
  top bar under 860px; stats drop to two columns and the user table scrolls
  horizontally under 560px; the top bar wraps. No layout breakpoints regress the
  desktop view.
- **Accessibility**: a "Skip to main content" link; visible keyboard focus rings
  (`:focus-visible`); `aria-label`s on icon-only controls (search, notifications)
  with `aria-expanded` on the notifications toggle; the sidebar user/sign-out is a
  real keyboard-operable `button`; modals get `role="dialog"` + `aria-modal` and
  move focus to their first field on open; error banners are `role="alert"` so
  they're announced; `aria-current="page"` tracks the active nav item; and
  `prefers-reduced-motion` disables animations.

### Tests

- 107 passing. The permissions-payload contract test (`auth.test.ts`) locks
  login/`/auth/me` to `ROLE_PERMISSIONS` per role and asserts permissions stay out
  of the JWT — this is the guarantee the role-aware UI relies on. The UI itself is
  verified per role via a Playwright smoke at desktop and mobile widths (see
  [`docs/ui-rbac-checklist.md`](docs/ui-rbac-checklist.md)).
