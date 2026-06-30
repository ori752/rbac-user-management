# Changelog

All notable changes to this project are documented here.
Format is based on [Keep a Changelog](https://keepachangelog.com/); the project
uses semantic-style versioning.

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

**Phase 5 — accessibility & responsive (this release)**
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
