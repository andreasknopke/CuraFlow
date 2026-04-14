# CuraFlow — Copilot Instructions

## Project Overview

CuraFlow is a **medical staff scheduling application** (Dienstplan) for radiology departments. It manages doctor shift assignments, vacation planning, training rotations, and service staffing across multiple workplaces (tenants).

## Architecture

- **Frontend:** React 18 SPA built with Vite, served as static files
- **Backend:** Express.js REST API (ES modules, Node 22)
- **Database:** MySQL 8.4 with parameterized queries (no ORM)
- **Multi-tenant:** Each tenant has its own database; tenant access via encrypted DB tokens
- **Deployment:** Railway (production), Docker Compose (local dev)
- **UI:** Tailwind CSS + shadcn/ui (Radix primitives)
- **State:** React Query (TanStack Query v5) for server state, React Context for auth

## Key Conventions

### General

- ES modules everywhere (`import`/`export`, `"type": "module"`)
- Use `@/` path alias for frontend imports (maps to `src/`)
- German-language UI strings (user-facing), English code and comments
- UUIDs for all primary keys (`crypto.randomUUID()`)

### Frontend (`src/`)

- React functional components only (no class components)
- React Query for all data fetching (`useQuery`, `useMutation`)
- Tailwind utility classes for styling (no CSS-in-JS, no inline styles)
- shadcn/ui components in `src/components/ui/` — do not modify these directly
- API access through `src/api/client.js` (`api` for REST calls, `db` for CRUD)

### Backend (`server/`)

- Express routes in `server/routes/`, utilities in `server/utils/`
- All SQL queries MUST use parameterized statements (`?` placeholders)
- Use `req.db` (injected by tenant middleware) for tenant-scoped queries
- Use the imported `db` pool for master database queries
- Error handling: use `next(error)` to pass to centralized error handler
- Column additions must use `ensureColumns()` from `server/utils/schema.js` (not `ADD COLUMN IF NOT EXISTS` — MySQL 8.4 doesn't support it)

### Database

- MySQL 8.4 (not MariaDB)
- `ADD COLUMN IF NOT EXISTS` is NOT supported — use `ensureColumns()` helper
- Timestamps: `created_date`, `updated_date` (auto-managed)
- Booleans stored as `TINYINT(1)`, converted in application layer
- JSON fields stored as `VARCHAR`/`TEXT`, parsed by `fromSqlRow()`

## File Structure

```
src/
├── api/client.js          # API client (fetch wrapper + CRUD helpers)
├── components/
│   ├── schedule/          # Core scheduling UI (ScheduleBoard)
│   ├── admin/             # Admin panel components
│   ├── settings/          # Settings dialogs
│   ├── ui/                # shadcn/ui primitives (don't modify)
│   └── ...
├── hooks/                 # Custom React hooks
├── pages/                 # Page-level components (route targets)
└── master/                # Master admin pages (cross-tenant)

server/
├── index.js               # Express app entry point
├── routes/                # Route handlers
├── utils/                 # Shared utilities
├── scripts/               # CLI tools and seed scripts
└── migrations/            # SQL migration references
```

## Testing

- Frontend: Vitest + React Testing Library (being set up)
- Backend: Vitest + Supertest (being set up)
- Run: `npm test` (frontend), `cd server && npm test` (backend)

## Important Constraints

1. **Railway deployment must always work** — never break Railway-specific config
2. **MySQL 8.4 compatibility** — no MariaDB-only syntax
3. **Multi-tenant isolation** — never leak data between tenants
4. **Incremental migration** — TypeScript and JS files coexist (`allowJs: true`)
