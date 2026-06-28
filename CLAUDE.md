# CLAUDE.md — Project Instructions

## Project Overview
Role-Based Access Control (RBAC) user management system. Built in Node.js + TypeScript with Express.
Provides REST API endpoints for user management, authentication, and permission enforcement.

## Stack
- **Runtime**: Node.js 18+
- **Language**: TypeScript (strict mode)
- **Framework**: Express
- **Auth**: JWT (jsonwebtoken)
- **Password hashing**: bcryptjs
- **Store**: In-memory (Map-based, no external DB dependency for this demo)

## Project Structure
```
src/
  index.ts          — Express app entry point
  types/rbac.ts     — Shared types: User, Role, Permission
  data/store.ts     — In-memory data store with seed data
  middleware/auth.ts — JWT verification + RBAC permission guard
  controllers/
    authController.ts  — login, logout, me
    userController.ts  — CRUD for users
  routes/
    auth.ts
    users.ts
```

## Roles & Permissions
| Role    | Can do                                      |
|---------|---------------------------------------------|
| admin   | Full access: manage users, roles, all reads |
| manager | Read all users, update roles (non-admin)    |
| user    | Read own profile, update own profile        |
| guest   | Read-only public info                       |

## Running the Project
```bash
npm install
npm run dev       # ts-node-dev hot reload
npm run build     # compile to dist/
npm start         # run compiled dist/index.js
```

## Testing the API
```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'

# Use returned token
curl http://localhost:3000/users \
  -H "Authorization: Bearer <token>"
```

## Development Rules (for Claude)
- Never expose password hashes in API responses.
- All routes except `/auth/login` require a valid JWT.
- Use `requirePermission()` middleware on every protected route.
- Keep business logic in controllers, routing only in routes/.
- No `any` types — use the shared types in `src/types/rbac.ts`.
- Seed data lives in `src/data/store.ts`, not scattered across controllers.
