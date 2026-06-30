# RBAC-aware UI — per-role checklist

The frontend makes **no authorization decisions of its own**: every control is
gated on `can(permission)`, where `permissions` comes from the API
(`/auth/login` and `/auth/me`) and equals `ROLE_PERMISSIONS[role]`. Hiding a
control is a UX convenience — the backend still enforces every rule, so a hidden
button is also a forbidden API call.

## What each role sees

| UI element                    | admin | manager | user | guest |
|-------------------------------|:-----:|:-------:|:----:|:-----:|
| Directory stats (4 cards)     | ✓     | ✓       |      |       |
| All-users table + role filters| ✓     | ✓       |      |       |
| "Your Access" panel (instead) |       |         | ✓    | ✓     |
| **+ New User** button         | ✓     |         |      |       |
| **Edit** user (any)           | ✓     |         |      |       |
| **Remove** user               | ✓     |         |      |       |
| **⬇ Import Property** button  | ✓     |         |      |       |
| Edit / change own password    | ✓     | ✓       | ✓    |       |
| Notifications bell            | ✓     | ✓       | ✓    | ✓     |

(Role-assignment controls in Edit honor the privilege-escalation guard: a manager
can assign only roles below their own.)

## Manual verification

1. Sign in with each seed account (admin/manager/user/guest — see project README).
2. Confirm the table above: the listed controls appear only for the ticked roles.
3. Confirm that hiding is backed by the server — e.g. as a manager, a `POST /users`
   still returns **403** even though the button is hidden.

## Accessibility checklist

- **Keyboard**: Tab from page load — the first stop is **"Skip to main content"**.
  All nav items, buttons, and the sign-out control are reachable and operable with
  Enter/Space; focus rings are visible.
- **Modals**: opening a modal moves focus into it; **Esc** closes it; clicking the
  backdrop closes it.
- **Screen reader**: icon-only controls announce a label ("Search users",
  "Notifications", "Sign out"); the notifications toggle exposes `aria-expanded`;
  validation/error banners are announced (`role="alert"`); the active nav item
  exposes `aria-current="page"`.
- **Motion**: with OS "reduce motion" enabled, animations/transitions are disabled.

## Responsive checklist

- **≥ 861px**: fixed 220px sidebar, four-column stats.
- **≤ 860px**: sidebar becomes a scrollable horizontal top bar; top bar wraps.
- **≤ 560px**: stats drop to two columns; the user table scrolls horizontally
  rather than crushing; search is hidden.

Verified with a Playwright smoke at 1280×800 and 390×780 (admin): all a11y
attributes present, no console/page errors, and the sidebar reflows from a
220px-wide vertical rail to a full-width horizontal bar.
