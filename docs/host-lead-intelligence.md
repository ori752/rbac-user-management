# Host Lead Intelligence — operator & compliance guide

A B2B prospecting module that surfaces **struggling short-term-rental hosts**
(property owners / commercial operators) as qualified leads for a
property-management company to approach. It diagnoses each listing's recurring
problem from public reviews, scores a delisting-risk *inference*, and produces a
ranked top-5 report with **business contact details for the host/owner only**.

---

## Compliance & data-sourcing note (for the manager)

> **Read this before showing leads to anyone outside the team.**

- **Runs on FIXTURE data by default.** Out of the box the module reads a small,
  bundled sample dataset (`scripts/prospecting/fixtures/sample-listings.json`).
  It performs **no web scraping, no network calls, and incurs no cost**. The
  default output is a *demonstration* of the pipeline, not real prospects.

- **Real leads require a COMPLIANT data source.** The module only yields genuine
  prospects once a lawful source is connected through the `partner` adapter —
  e.g. an **official/partner marketplace API, a licensed dataset, or data you are
  contractually permitted to use**. There is **no scraping, no proxy rotation, no
  CAPTCHA/anti-bot evasion** anywhere in the codebase, and none will be added; the
  `partner` adapter is a documented stub that you wire to an approved source.

- **The lead is always the host/owner — never the guest.** Hosts are commercial
  operators and are legitimate B2B prospects. **Guests/reviewers are never
  stored, profiled, or identified** — the data model has no field for a reviewer's
  name or identity, by design.

- **Business contact only.** Enrichment is limited to professional/business
  contact details (management company, business email/phone/website, company
  LinkedIn). **No personal home addresses, personal social accounts, or
  username-hunting.**

- **"Delisting risk" is an INFERENCE, labeled as such.** The distress score is
  derived purely from public review/rating signals. It does **not** reflect any
  Airbnb/Booking-internal delisting status. This disclaimer is attached to
  **every surface**: the JSON report (`disclaimer` field), the human-readable
  summary, the manager notification, and the Leads page in the app.

- **Access is RBAC-gated.** Only **admins and managers** can view leads
  (`leads:read`); only **admins** can trigger a run (`leads:run`). Users and
  guests cannot see the Leads page or the data at all.

---

## Running it

### CLI (no server)

```bash
npm run leads                      # fixture source — zero scraping, zero cost
npm run leads -- --limit 3
npm run leads -- --json            # print the full report JSON
npm run leads -- --source partner  # only works once a compliant source is wired
```

The report is written to `scripts/prospecting/output/leads-latest.json`
(gitignored) and printed as a human-readable summary; the manager notification
fires (console always; email/Slack when configured).

### Web (RBAC-gated)

1. Start the server (`npm run dev` or `npm start`) and sign in.
2. **Admin / Manager** see a **"Leads"** item in the sidebar → ranked lead cards
   + the inference disclaimer.
3. **Admin** also sees a **"Run pipeline"** button to regenerate the report.

### Connecting a compliant source later

Implement the `ListingSource` interface in
`scripts/prospecting/sources/partnerApi.ts` against your approved API/dataset,
set its credentials in `.env` (e.g. `LEADS_PARTNER_API_KEY`), and run with
`--source partner`. Everything downstream (analysis, scoring, report, RBAC,
disclaimer) is unchanged.

---

## Per-role access checklist (runnable)

Verifies the RBAC contract end-to-end. Start a server, then run the block; every
status must match the **Expect** column. (Replace `3000` with your port.)

```bash
BASE=http://localhost:3000
login() { curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }
ADMIN=$(login admin@example.com admin123);   MANAGER=$(login manager@example.com manager123)
USER=$(login user@example.com user1234);     GUEST=$(login guest@example.com guest123)
code() { curl -s -o /dev/null -w "%{http_code}\n" "$@"; }

code $BASE/leads                                   # no token        → 401
code -H "Authorization: Bearer $GUEST"   $BASE/leads      # guest    → 403
code -H "Authorization: Bearer $USER"    $BASE/leads      # user     → 403
code -H "Authorization: Bearer $MANAGER" $BASE/leads      # manager  → 200
code -H "Authorization: Bearer $ADMIN"   $BASE/leads      # admin    → 200
code -X POST -H "Authorization: Bearer $GUEST"   $BASE/leads/run   # guest    → 403
code -X POST -H "Authorization: Bearer $USER"    $BASE/leads/run   # user     → 403
code -X POST -H "Authorization: Bearer $MANAGER" $BASE/leads/run   # manager  → 403 (reads, cannot run)
code -X POST -H "Authorization: Bearer $ADMIN"   $BASE/leads/run   # admin    → 200 (runs pipeline)
```

| Role    | `GET /leads` | `POST /leads/run` | "Leads" nav | "Run" button |
|---------|:------------:|:-----------------:|:-----------:|:------------:|
| _none_  | 401          | 401               | —           | —            |
| guest   | **403**      | **403**           | hidden      | hidden       |
| user    | **403**      | **403**           | hidden      | hidden       |
| manager | **200**      | **403**           | visible     | **hidden**   |
| admin   | **200**      | **200**           | visible     | visible      |

---

## Test inventory

`npm test` → **136 passing across 7 suites.** Prospecting/leads coverage:

| Suite | Tests | Covers |
|-------|:-----:|--------|
| `src/__tests__/rbac.test.ts` | 37 | Permission matrix incl. **`leads:read` (admin+manager)** and **`leads:run` (admin-only)** split |
| `src/__tests__/leads.test.ts` | 10 | `GET /leads` 401/403/403/200/200; `POST /leads/run` 403/403/403; **409 while a run holds the lock**; **a failed run releases the lock** (no permanent 409 wedge) |
| `scripts/prospecting/__tests__/report.test.ts` | 6 | Ranking; **qualified-lead floor** incl. fewer-than-5; **disclaimer on the JSON report and the summary**; business-contact-only (no reviewer identity) |
| `scripts/prospecting/__tests__/analysis.test.ts` | 7 | Heuristic diagnosis is valid + deterministic; `computeDistress` bounds/basis/ranking; **`selectAnalyzer` picks Claude with a key, heuristic without** |
| `scripts/prospecting/__tests__/fixture.test.ts` | 5 | Fixture loads; **reviews never carry reviewer identity**; hosts are business-only; `--limit` caps; default source is `fixture` |

**Intentional gaps (verified live instead of in CI, to keep the suite fast and
offline):**

- **`POST /leads/run` admin happy-path** spawns the CLI as a child process —
  verified by the live per-role proof (admin → 200 with a populated report),
  not in Jest.
- **`ClaudeReviewAnalyzer` live API call** is never exercised in tests (no key in
  CI). Its fallback-to-heuristic path is covered indirectly via `selectAnalyzer`
  and the analyzer's own try/catch.
