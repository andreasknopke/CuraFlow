# CuraFlow — Comprehensive Refactoring Plan

> **Goal:** Safely migrate the CuraFlow codebase to a sustainable, maintainable, and testable quality level without breaking the working application or Railway deployment.

## Executive Summary

| Metric            | Current                                    | Target                                        |
| ----------------- | ------------------------------------------ | --------------------------------------------- |
| **Total LOC**     | ~56,400 (frontend 43,900 + backend 12,500) | ~45,000 (reduced via deduplication)           |
| **Language**      | JavaScript / JSX                           | TypeScript / TSX (Phase 8 conversion)         |
| **Test coverage** | 0%                                         | 70%+ (critical paths)                         |
| **ESLint errors** | 201 errors, 77 warnings                    | 0 errors, 0 warnings                          |
| **Largest file**  | 4,743 lines (`ScheduleBoard.jsx`)          | ≤ 400 lines per file                          |
| **CI/CD**         | None                                       | Full pipeline (lint, type-check, test, build) |
| **Type safety**   | None                                       | Strict TypeScript with shared types           |

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Guiding Principles](#2-guiding-principles)
3. [Phase 0 — Foundation & Safety Rails](#3-phase-0--foundation--safety-rails)
4. [Phase 1 — Code Quality Baseline](#4-phase-1--code-quality-baseline)
5. [Phase 2 — TypeScript Migration](#5-phase-2--typescript-migration)
6. [Phase 3 — Frontend Architecture](#6-phase-3--frontend-architecture)
7. [Phase 4 — Backend Architecture](#7-phase-4--backend-architecture)
8. [Phase 5 — Testing](#8-phase-5--testing)
9. [Phase 6 — Security Hardening](#9-phase-6--security-hardening)
10. [Phase 7 — Developer Experience](#10-phase-7--developer-experience)
11. [Phase 8 — Full TypeScript Conversion](#11-phase-8--full-typescript-conversion)
12. [Risk Register](#12-risk-register)
13. [File Inventory — Critical Refactoring Targets](#13-file-inventory--critical-refactoring-targets)
14. [Appendix — Analysis Data](#14-appendix--analysis-data)

---

## 1. Current State Assessment

### 1.1 What Works Well

- ✅ **The application runs and is used in production** — this is the single most important fact
- ✅ **Railway deployment pipeline is operational** — must be preserved
- ✅ **React Query** used consistently (54 components) for server state
- ✅ **Tailwind CSS** adopted across 97 components — consistent styling
- ✅ **shadcn/ui + Radix primitives** for accessible UI components
- ✅ **Parameterized SQL queries everywhere** — no SQL injection risk
- ✅ **bcrypt password hashing** (12 rounds)
- ✅ **Rate limiting** on auth and API endpoints
- ✅ **AES-256-GCM** encryption for DB tokens
- ✅ **SSE-based realtime** updates with multi-tenant scoping
- ✅ **Excellent documentation** (20 comprehensive markdown files)
- ✅ **Multi-tenant database isolation** with per-tenant connection pools
- ✅ **Docker Compose** local development stack

### 1.2 Critical Problems

| #   | Problem                                        | Impact                                                      | Location                                    |
| --- | ---------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| 1   | **No tests whatsoever**                        | Cannot refactor safely                                      | Entire codebase                             |
| 2   | **Zero TypeScript**                            | Silent type bugs, no IDE safety                             | 180 frontend + 30 backend files             |
| 3   | **ScheduleBoard.jsx is 4,743 lines**           | Unmaintainable, 28 useState, 252 handlers                   | `src/components/schedule/`                  |
| 4   | **201 ESLint errors**                          | React Hooks violations cause runtime bugs                   | Multiple files                              |
| 5   | **No CI/CD pipeline**                          | Broken code merges undetected                               | Repository config                           |
| 6   | **Backend monoliths**                          | `master.js` (1,371), `admin.js` (1,328), `dbProxy.js` (853) | `server/routes/`                            |
| 7   | **API client imports UI**                      | Circular dependency risk                                    | `src/api/client.js` line 7                  |
| 8   | **Hooks scattered across 4 directories**       | Duplicate hooks, naming collisions                          | `src/hooks/`, `src/components/hooks/`, etc. |
| 9   | **16 dialog components with ~60% duplication** | Copy-paste bugs                                             | `src/components/*/`                         |
| 10  | **Magic strings everywhere**                   | localStorage keys, API endpoints, role names                | Throughout                                  |
| 11  | **No input validation on API**                 | Unexpected data causes cryptic errors                       | `server/routes/`                            |
| 12  | **CORS allows all origins**                    | Comment says "for debugging" but runs in prod               | `server/index.js` line 381                  |
| 13  | **JWT has no refresh/revocation**              | 24h window if token stolen                                  | `server/routes/auth.js`                     |
| 14  | **No env var validation at startup**           | Silent failures if config missing                           | `server/index.js`                           |

### 1.3 Codebase Statistics

**Frontend (src/):**

- 180 JS/JSX files, 43,933 total lines
- 30 files exceed 400 lines (the recommended maximum)
- 11 components exceed 500 lines
- 54 files use React Query
- 0 files use PropTypes or TypeScript types
- 0 test files

**Backend (server/):**

- 30 JS files, 12,444 total lines
- 11 route files (6,178 lines total, avg 562 lines)
- 7 utility modules (1,211 lines total)
- 6 scripts (714 lines total)
- 0 test files, 4 files with JSDoc

---

## 2. Guiding Principles

1. **Never break production.** Every change must keep Railway deployment functional. The test is: `docker compose up --build` passes and `npm run build` succeeds.

2. **Incremental migration.** TypeScript can coexist with JavaScript. Converted files work alongside unconverted ones. No big-bang rewrites.

3. **Tests before refactoring.** Before splitting a file, write integration tests that capture its current behavior. The tests are the safety net.

4. **One concern per PR.** Each pull request touches one refactoring concern (e.g., "extract useScheduleState hook" or "add TypeScript to api/client"). Small PRs are easier to review and revert.

5. **Automate quality gates.** CI must enforce lint, type-check, and test before merge. This prevents regression as the team works.

6. **Preserve the domain model.** The database schema, API contract, and tenant isolation model are correct. Refactoring targets code structure, not business logic.

---

## 3. Phase 0 — Foundation & Safety Rails

> **Goal:** Set up the infrastructure that makes all subsequent refactoring safe.

### 0.1 CI/CD Pipeline (GitHub Actions)

Create `.github/workflows/ci.yml`:

```yaml
# Triggers on push to main and all PRs
# Jobs:
#   lint     — ESLint (zero errors required)
#   typecheck — tsc --noEmit (once TypeScript is adopted)
#   test     — vitest run
#   build    — vite build + server syntax check (node --check)
```

**Rationale:** Without CI, any change can break the build and go unnoticed. This is the single highest-leverage improvement.

### 0.2 Git Hooks (Husky + lint-staged)

```bash
npm install -D husky lint-staged
```

Configure `lint-staged` in `package.json`:

```json
{
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"]
  }
}
```

**Rationale:** Catches issues before commit, reduces CI failures, enforces formatting consistency without debate.

### 0.3 Prettier

```bash
npm install -D prettier eslint-config-prettier
```

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

Run once: `npx prettier --write "src/**/*.{js,jsx}" "server/**/*.js"` — this is a formatting-only change, no logic changes, safe to merge immediately.

### 0.4 `.env.example`

Create `.env.example` with all environment variables documented:

```bash
# Database (required)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=curaflow
MYSQL_PASSWORD=
MYSQL_DATABASE=curaflow

# Security (required)
JWT_SECRET=

# Email (optional)
BREVO_API_KEY=
SMTP_HOST=
# ... etc.
```

### 0.5 Copilot Instructions

Create `.github/copilot-instructions.md` with project conventions, architecture overview, and coding standards to guide AI-assisted development.

### 0.6 ESLint Auto-fix (186 fixable errors)

```bash
npx eslint --fix "src/**/*.{js,jsx}"
```

This resolves 186 of 278 problems automatically. The remaining 92 need manual review (React Hooks violations, unused vars).

### Phase 0 Deliverables

| Deliverable                       | Type                | Risk                          |
| --------------------------------- | ------------------- | ----------------------------- |
| `.github/workflows/ci.yml`        | New file            | None                          |
| Husky + lint-staged               | Config              | None                          |
| Prettier setup + format run       | Config + formatting | None (formatting only)        |
| `.env.example`                    | New file            | None                          |
| `.github/copilot-instructions.md` | New file            | None                          |
| ESLint auto-fix                   | Code changes        | Low (auto-fixable rules only) |

---

## 4. Phase 1 — Code Quality Baseline

> **Goal:** Fix remaining ESLint errors and establish code quality standards.

### 1.1 Fix React Hooks Violations (CRITICAL)

These are **runtime bugs**, not style issues:

| File                               | Issue                         | Fix                                          |
| ---------------------------------- | ----------------------------- | -------------------------------------------- |
| `src/pages/Staff.jsx` lines 46-108 | Hooks inside conditions/loops | Extract to custom hook, call unconditionally |
| `src/pages/Statistics.jsx` line 97 | Conditional hook call         | Move hook before conditional return          |

### 1.2 Fix Unused Variables & Imports

Run `npx eslint --rule '{"no-unused-vars": "error"}' src/` to identify all unused declarations. Remove them systematically.

### 1.3 Remove `console.log` Statements

- Frontend: 100+ `console.log` calls — replace with nothing (React Query handles loading/error states)
- Backend: Replace `console.log`/`console.error` with structured logger (see Phase 7)

### 1.4 Extract Constants from Magic Strings

Create `src/constants/`:

```
src/constants/
├── storage-keys.ts    # localStorage key constants
├── api-endpoints.ts   # API URL patterns
├── query-keys.ts      # React Query key factories
└── roles.ts           # User/team role constants
```

Backend equivalent:

```
server/constants/
├── errors.js          # Error codes and messages
├── roles.js           # Default team roles
└── config.js          # Validated configuration object
```

### Phase 1 Deliverables

| Deliverable                                       | Risk                              | Validation                         |
| ------------------------------------------------- | --------------------------------- | ---------------------------------- |
| Fix hooks violations in Staff.jsx, Statistics.jsx | Medium — behavior change possible | Manual test schedule + staff pages |
| Remove unused imports/vars                        | Low                               | ESLint passes                      |
| Console.log cleanup                               | Low                               | grep confirms removal              |
| Constants extraction                              | Low                               | Find-and-replace, no logic change  |

---

## 5. Phase 2 — TypeScript Migration

> **Goal:** Incrementally add TypeScript starting from the highest-value files.

### 2.1 TypeScript Setup

```bash
npm install -D typescript @types/react @types/react-dom @types/node
# Backend:
cd server && npm install -D typescript @types/express @types/bcryptjs @types/jsonwebtoken @types/compression @types/cors
```

Create `tsconfig.json` (frontend):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "allowJs": true, // ← KEY: allows mixed JS/TS
    "checkJs": false, // Don't check JS files yet
    "noEmit": true, // Vite handles compilation
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

Create `server/tsconfig.json` (backend):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "outDir": "./dist"
  },
  "include": ["."]
}
```

**`allowJs: true` is the key** — it lets `.ts`/`.tsx` files coexist with `.js`/`.jsx` files. We migrate one file at a time.

### 2.2 Migration Order (highest value first)

**Tier 1 — Shared types and API layer:**

```
1. src/types/                     # NEW: shared type definitions
   ├── api.ts                     # API response shapes
   ├── models.ts                  # Doctor, Workplace, Shift, etc.
   ├── schedule.ts                # Schedule-specific types
   └── auth.ts                    # User, token, permission types

2. src/api/client.ts              # Rename + add types (701 lines)
3. src/constants/*.ts             # Already TypeScript from Phase 1
4. server/types/                  # NEW: backend type definitions
```

**Tier 2 — Hooks and utilities:**

```
5. src/hooks/*.ts                 # All custom hooks (small files, high reuse)
6. server/utils/*.ts              # Backend utilities (schema, crypto, email)
```

**Tier 3 — Components (by size, smallest first):**

```
7. Small UI components (<100 LOC) — quick wins, build confidence
8. Medium components (100-400 LOC) — bulk of the work
9. Large components (400+ LOC) — after splitting (Phase 3)
```

**Tier 4 — Pages and backend routes:**

```
10. src/pages/*.tsx               # Page components
11. server/routes/*.ts            # Backend routes (after splitting)
```

### 2.3 Type Definition Examples

```typescript
// src/types/models.ts
export interface Doctor {
  id: string;
  name: string;
  email?: string;
  position: string;
  qualifications: string[];
  is_active: boolean;
  created_date: string;
  updated_date: string;
}

export interface Workplace {
  id: string;
  name: string;
  short_name: string;
  category: 'Dienst' | 'Arbeitsplatz';
  active_days: boolean[];
  allows_multiple: boolean;
  min_staff?: number;
  max_staff?: number;
}

export interface ShiftEntry {
  id: string;
  doctor_id: string;
  workplace_id: string;
  date: string; // YYYY-MM-DD
  created_date: string;
  updated_date: string;
}
```

### 2.4 Migration Strategy Per File

For each file conversion:

1. Rename `.js` → `.ts` (or `.jsx` → `.tsx`)
2. Add explicit types to function parameters and return values
3. Replace `any` with proper types
4. Fix type errors
5. Run `tsc --noEmit` to verify
6. Update imports in consuming files (Vite resolves automatically)

**Important:** Vite handles `.ts`/`.tsx` natively — no build config changes needed.

### Phase 2 Deliverables

| Deliverable                       | Risk         | Validation                       |
| --------------------------------- | ------------ | -------------------------------- |
| tsconfig.json (both)              | None         | `tsc --noEmit` passes            |
| Shared type definitions           | None         | New files only                   |
| API client migration              | Medium       | All API calls still work         |
| Hooks migration                   | Low          | Small files, easy to verify      |
| Component migration (incremental) | Low per file | `npm run build` after each batch |

---

## 6. Phase 3 — Frontend Architecture

> **Goal:** Break apart monolithic components, consolidate patterns, eliminate duplication.

### 3.1 ScheduleBoard Decomposition (CRITICAL — 4,743 → ~5 × 400 lines)

**Current structure (single file):**

```
ScheduleBoard.jsx (4,743 lines)
├── 28 useState calls
├── 252 functions/handlers
├── 14 try-catch blocks
├── 50+ console.log statements
├── Drag-and-drop logic
├── UI rendering
├── Business logic
├── Keyboard shortcuts
├── Print handling
└── Settings dialogs
```

**Target structure:**

```
src/components/schedule/
├── ScheduleBoard.tsx              # Container (~300 lines) — orchestration only
├── ScheduleGrid.tsx               # Grid rendering (~400 lines)
├── ScheduleToolbar.tsx            # Toolbar + filters (~200 lines)
├── ScheduleSidebar.tsx            # Sidebar panel (~200 lines)
├── DraggableDoctor.tsx            # Drag source (~100 lines, already exists)
├── DraggableShift.tsx             # Drop target (~100 lines, already exists)
├── hooks/
│   ├── useScheduleState.ts        # All 28 useState → single reducer (~200 lines)
│   ├── useScheduleActions.ts      # Mutation handlers (~300 lines)
│   ├── useDragDrop.ts             # DnD state management (~150 lines)
│   ├── useScheduleKeyboard.ts     # Keyboard shortcuts (~100 lines)
│   └── useSchedulePrint.ts        # Print handling (~50 lines)
├── utils/
│   ├── scheduleCalculations.ts    # Pure business logic (~200 lines)
│   └── scheduleFormatters.ts      # Display formatting (~100 lines)
└── types.ts                       # Schedule-specific types
```

**Step-by-step decomposition:**

1. Write integration tests for ScheduleBoard (Phase 5 dependency)
2. Extract `useScheduleState` — convert 28 useState to `useReducer` with typed actions
3. Extract `useScheduleActions` — move all mutation/API handlers
4. Extract `useDragDrop` — isolate drag-and-drop state
5. Extract `ScheduleGrid` — pull out the grid rendering JSX
6. Extract `ScheduleToolbar` — pull out toolbar/filters
7. Extract pure utility functions to `utils/`
8. Verify all tests still pass after each extraction

### 3.2 Consolidate Hooks (4 locations → 1)

**Current:**

```
src/hooks/use-mobile.jsx          # Duplicate!
src/hooks/useQualifications.js
src/components/hooks/useIsMobile.jsx  # Duplicate!
src/components/useHolidays.jsx
src/components/validation/         # Contains hooks
```

**Target:**

```
src/hooks/
├── useAuth.ts                     # Re-export from AuthProvider
├── useDoctors.ts                  # Doctor query hook
├── useHolidays.ts                 # Holiday query hook
├── useIsMobile.ts                 # Single implementation
├── useQualifications.ts           # Qualification query hook
├── useSchedule.ts                 # Schedule query hooks
├── useShifts.ts                   # Shift query hooks
└── useWishes.ts                   # Wish query hooks
```

### 3.3 Dialog Abstraction (~60% duplication → shared pattern)

Create `src/components/shared/FormDialog.tsx`:

```typescript
interface FormDialogProps<T> {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultValues: T;
  onSubmit: (values: T) => Promise<void>;
  children: (form: UseFormReturn<T>) => React.ReactNode;
}

export function FormDialog<T>({
  title,
  open,
  onOpenChange,
  defaultValues,
  onSubmit,
  children,
}: FormDialogProps<T>) {
  // Shared: open/close state, form state, mutation, error handling, Cancel/Save buttons
}
```

This replaces the duplicated pattern in 16 dialog components.

### 3.4 Extract Common Query Hooks

Create standardized data-fetching hooks:

```typescript
// src/hooks/useDoctors.ts
export function useDoctors() {
  return useQuery({
    queryKey: queryKeys.doctors.all,
    queryFn: () => db.Doctor.list(),
  });
}

export function useDoctor(id: string) {
  return useQuery({
    queryKey: queryKeys.doctors.detail(id),
    queryFn: () => db.Doctor.get(id),
    enabled: !!id,
  });
}
```

### 3.5 API Client Refactoring

**Fix circular dependency:**

```
BEFORE: client.js → imports toast from UI → UI imports client.js
AFTER:  client.ts → throws errors → hooks catch errors → hooks show toast
```

**Split by domain:**

```
src/api/
├── client.ts           # Core fetch wrapper (~200 lines)
├── auth.ts             # Auth endpoints
├── db.ts               # Generic CRUD operations
├── schedule.ts         # Schedule endpoints
├── interceptors.ts     # Error handling, retry logic
└── types.ts            # API types
```

### 3.6 Code Splitting (Lazy Loading)

```typescript
// src/pages.config.ts
const Admin = lazy(() => import('./pages/Admin'));
const Training = lazy(() => import('./pages/Training'));
const Statistics = lazy(() => import('./pages/Statistics'));
// ... etc.
```

Reduces initial bundle by ~30%.

### 3.7 Barrel Exports

Add `index.ts` to each component directory for clean imports:

```typescript
// src/components/schedule/index.ts
export { ScheduleBoard } from './ScheduleBoard';
export { ScheduleGrid } from './ScheduleGrid';
// etc.
```

### Phase 3 Deliverables

| Deliverable                 | Risk                           | Validation                          |
| --------------------------- | ------------------------------ | ----------------------------------- |
| ScheduleBoard decomposition | **High** — most complex change | Integration tests (Phase 5)         |
| Hooks consolidation         | Low                            | All existing uses updated           |
| Dialog abstraction          | Medium                         | Each dialog still renders correctly |
| Query hooks extraction      | Low                            | React Query devtools verification   |
| API client split            | Medium                         | All API calls still work            |
| Code splitting              | Low                            | Build succeeds, pages load          |

---

## 7. Phase 4 — Backend Architecture

> **Goal:** Split monolithic route files, add validation, improve error handling.

### 4.1 Split Large Route Files

**`routes/admin.js` (1,328 lines) → 4 modules:**

```
server/routes/admin/
├── index.js              # Router aggregation (~50 lines)
├── tokens.js             # Token generation/encryption (~100 lines)
├── integrity.js          # DB integrity check + repair (~400 lines)
├── migrations.js         # Migration management (~200 lines)
└── operations.js         # Export, wipe, settings (~300 lines)
```

**`routes/master.js` (1,371 lines) → 3 modules:**

```
server/routes/master/
├── index.js              # Router aggregation (~50 lines)
├── aggregation.js        # Cross-tenant data aggregation (~500 lines)
├── employees.js          # Employee management (~400 lines)
└── holidays.js           # Holiday management (~200 lines)
```

**`routes/dbProxy.js` (853 lines) → separated concerns:**

```
server/routes/db/
├── index.js              # Router (~50 lines)
├── operations.js         # CRUD operations (~400 lines)
├── validators.js         # Input validation middleware (~150 lines)
├── sentinels.js          # Conflict checking, lock detection (~200 lines)
└── cache.js              # Column cache, workplace cache (~100 lines)
```

### 4.2 Input Validation Layer

Add `express-validator` or `zod` for request validation:

```javascript
// server/middleware/validate.js
import { z } from 'zod';

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten(),
      });
    }
    req.validated = result.data;
    next();
  };
}

// Usage in routes:
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  const { email, password } = req.validated;
  // ...
});
```

### 4.3 Startup Configuration Validation

```javascript
// server/config.js
const requiredEnvVars = [
  'MYSQL_HOST',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'MYSQL_DATABASE',
  'JWT_SECRET',
];

export function validateConfig() {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}
```

### 4.4 Structured Logging

Replace `console.log`/`console.error` with structured logger:

```javascript
// server/utils/logger.js
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});
```

### 4.5 Slim Down `index.js` (805 → ~200 lines)

Extract from `index.js` into separate modules:

- `server/middleware/cors.js` — CORS configuration
- `server/middleware/security.js` — Helmet + rate limiting
- `server/middleware/tenant.js` — Tenant DB middleware (already partially there)
- `server/db/pool.js` — Connection pool creation + retry wrapper
- `server/startup.js` — Migration runner + table seeding

### Phase 4 Deliverables

| Deliverable          | Risk   | Validation                                |
| -------------------- | ------ | ----------------------------------------- |
| Route file splitting | Medium | All API endpoints still respond correctly |
| Input validation     | Low    | New middleware, additive                  |
| Config validation    | Low    | Startup fails fast with clear message     |
| Structured logging   | Low    | Replace console calls                     |
| index.js slimming    | Medium | Server boots and responds to /health      |

---

## 8. Phase 5 — Testing

> **Goal:** Add test coverage for critical paths to enable safe refactoring.

### 5.1 Test Framework Setup

**Frontend:**

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Configure in `vite.config.js`:

```javascript
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

**Backend:**

```bash
cd server && npm install -D vitest supertest
```

### 5.2 Test Priority Order

**Priority 1 — Pure logic (no mocking needed, highest value):**

```
src/components/schedule/autoFillEngine.js     # 1,832 lines of algorithms
src/components/schedule/costFunction.js       # 622 lines of calculations
src/components/validation/ShiftValidation.jsx  # 630 lines of validation rules
server/utils/crypto.js                        # Encryption/decryption
server/utils/schema.js                        # Column existence checking
```

**Priority 2 — API layer (mock HTTP, verify contracts):**

```
src/api/client.js                             # Request/response handling
server/routes/auth.js                         # Login, register, JWT
server/routes/dbProxy.js                      # CRUD operations
```

**Priority 3 — Integration tests (need test database):**

```
server/routes/schedule.js                     # Schedule read operations
server/routes/admin.js                        # Admin operations
server/utils/masterMigrations.js              # Schema migrations
```

**Priority 4 — Component tests (React Testing Library):**

```
src/components/schedule/ScheduleBoard.jsx     # After decomposition
src/components/AuthProvider.jsx               # Auth flow
src/pages/MyDashboard.jsx                     # Dashboard rendering
```

### 5.3 Test Examples

```typescript
// src/components/schedule/__tests__/autoFillEngine.test.ts
import { describe, it, expect } from 'vitest';
import { generateSuggestions } from '../autoFillEngine';

describe('autoFillEngine', () => {
  it('assigns doctors to required service shifts first', () => {
    const schedule = createEmptySchedule(/* ... */);
    const doctors = [createDoctor({ qualifications: ['Dienst'] })];
    const result = generateSuggestions(schedule, doctors, workplaces);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].workplace.category).toBe('Dienst');
  });

  it('does not assign doctors on vacation days', () => {
    // ...
  });
});
```

```typescript
// server/__tests__/auth.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index';

describe('POST /api/auth/login', () => {
  it('returns JWT for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: '<test-admin-password>' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('returns 401 for invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
```

### Phase 5 Deliverables

| Deliverable                       | Risk   | Validation          |
| --------------------------------- | ------ | ------------------- |
| Vitest setup (frontend + backend) | None   | `npm test` runs     |
| Priority 1 tests (pure logic)     | None   | Tests pass          |
| Priority 2 tests (API)            | Low    | Tests pass          |
| Priority 3 tests (integration)    | Medium | Needs test DB       |
| Priority 4 tests (components)     | Medium | After decomposition |

---

## 9. Phase 6 — Security Hardening

> **Goal:** Address the security vulnerabilities identified in the audit.

### 6.1 JWT Token Refresh

```javascript
// Add refresh token endpoint
router.post('/refresh', authMiddleware, async (req, res) => {
  const newToken = createToken({
    sub: req.user.sub,
    email: req.user.email,
    role: req.user.role,
    doctor_id: req.user.doctor_id,
  });
  res.json({ token: newToken });
});
```

Reduce access token expiry from 24h to 1h, add refresh token with 7-day expiry.

### 6.2 Fix CORS "Allow All"

```javascript
// server/index.js — Replace:
callback(null, true); // Allow anyway for debugging
// With:
console.warn(`[CORS] Blocked origin: ${origin}`);
callback(new Error('Not allowed by CORS'));
```

### 6.3 Validate X-DB-Token Against User Permissions

In `tenantDbMiddleware`, cross-reference the provided DB token against the user's `allowed_tenants` list.

### 6.4 Audit Logging for Admin Operations

```javascript
// server/utils/auditLog.js
export async function auditLog(db, { action, userId, details }) {
  await db.execute(
    'INSERT INTO audit_log (id, action, user_id, details, created_at) VALUES (?, ?, ?, ?, NOW())',
    [crypto.randomUUID(), action, userId, JSON.stringify(details)],
  );
}
```

### 6.5 Enable Content Security Policy

Configure CSP headers appropriate for the application (currently disabled).

### Phase 6 Deliverables

| Deliverable         | Risk   | Validation                         |
| ------------------- | ------ | ---------------------------------- |
| JWT refresh tokens  | Medium | Login flow still works             |
| CORS fix            | Low    | Test with real origins             |
| DB token validation | Medium | Multi-tenant access tested         |
| Audit logging       | Low    | Additive                           |
| CSP headers         | Medium | Frontend still loads all resources |

---

## 10. Phase 7 — Developer Experience

> **Goal:** Make the codebase pleasant to work in.

### 7.1 Monorepo Workspace (Optional)

If the project grows, consider npm workspaces:

```
packages/
├── frontend/     # React app
├── backend/      # Express server
└── shared/       # Shared types, constants
```

For now, the single-repo structure with `src/` and `server/` is fine.

### 7.2 API Documentation

Add Swagger/OpenAPI documentation for all 30+ API endpoints. This can be generated from route definitions using `swagger-jsdoc`.

### 7.3 Database Schema Documentation

Create `docs/DATABASE_SCHEMA.md` documenting all tables, their columns, and relationships. This is currently only documented implicitly in migration files.

### 7.4 Storybook (Optional)

For the 26+ shadcn/ui components, Storybook provides visual testing and documentation. Consider this after TypeScript migration is complete.

### 7.5 VS Code Workspace Settings

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```

---

## 11. Phase 8 — Full TypeScript Conversion

> **Goal:** Convert all remaining `.js`/`.jsx` files to `.ts`/`.tsx` across frontend and backend, achieving a 100% TypeScript codebase.

### Why This Wasn't Done Earlier

Phases 0–6 intentionally deferred bulk file conversion. The strategy was:

1. **Phase 2** established TypeScript infrastructure (tsconfig, shared types, `allowJs: true` mixed mode).
2. **Phases 3–4** decomposed monolithic files into smaller, well-bounded modules — making conversion safer.
3. **Phase 5** added a test safety net to catch conversion regressions.
4. **Phase 6** hardened security so that token/auth types are well-defined.

Only new/extracted modules were written as `.ts`/`.tsx`. Bulk-converting existing files while simultaneously restructuring them would have doubled the risk surface.

Now that the architecture is stable and tested, bulk conversion is safe.

### 8.0 Current Inventory (files requiring conversion)

| Category                | Count | Lines   | Notes                                     |
| ----------------------- | ----- | ------- | ----------------------------------------- |
| **Frontend JSX**        | 158   | ~44,500 | 49 shadcn/ui, 14 schedule, 13 pages, etc. |
| **Frontend JS**         | 20    | ~4,265  | API client, engines, utilities            |
| **Server JS**           | 45    | ~10,900 | Routes, utils, middleware, scripts        |
| **Test files (JS/JSX)** | 12    | ~800    | Converted alongside their source          |
| **Already TS/TSX**      | 17    | ~1,200  | Types, hooks, constants, utils            |
| **Excluded (.md.jsx)**  | 3     | —       | Markdown content, rename to `.md` only    |

**Total files to convert: ~223** (excluding `.md.jsx` and already-TS files).

### 8.1 Tier 1 — Low-Risk Quick Wins (small utilities, constants, lib)

Files under 100 lines with no complex types. Pure renames + add parameter types.

```
Frontend JS:
  src/utils/wishRange.js                      →  .ts    (39 lines)
  src/utils/doctorSorting.js                  →  .ts    (21 lines)
  src/utils/autoFrei.js                       →  .ts    (14 lines)
  src/utils/workplaceCategoryUtils.js         →  .ts    (64 lines)
  src/utils/staffingUtils.js                  →  .ts    (0 lines — empty, delete or stub)
  src/utils/holidays.js                       →  .ts    (0 lines — empty, delete or stub)
  src/utils/dbTracker.js                      →  .ts    (0 lines — empty, delete or stub)
  src/api/entities.js                         →  .ts    (6 lines)
  src/api/integrations.js                     →  .ts    (15 lines)
  src/lib/utils.js                            →  .ts    (8 lines)
  src/lib/environment.js                      →  .ts    (8 lines)
  src/lib/query-client.js                     →  .ts    (10 lines)
  src/lib/app-params.js                       →  .ts    (52 lines)
  src/contexts/AuthContext.js                 →  .ts    (0 lines — re-export, delete or stub)
  src/pages.config.js                         →  .ts    (36 lines)

Frontend JSX (tiny components, <50 lines):
  src/components/ui/input.jsx                 →  .tsx
  src/components/ui/textarea.jsx              →  .tsx
  src/components/ui/badge.jsx                 →  .tsx
  src/components/ui/separator.jsx             →  .tsx
  src/components/ui/skeleton.jsx              →  .tsx
  src/components/ui/progress.jsx              →  .tsx
  src/components/ui/checkbox.jsx              →  .tsx
  src/components/ui/switch.jsx                →  .tsx
  src/components/ui/slider.jsx                →  .tsx
  src/components/ui/button.jsx                →  .tsx
  src/components/ui/card.jsx                  →  .tsx
  src/components/ui/avatar.jsx                →  .tsx
  src/components/ui/toggle.jsx                →  .tsx
  src/components/ui/collapsible.jsx           →  .tsx

Markdown content (rename, no code change):
  src/components/docs/AuthMigrationPlan.md.jsx  →  .md (or keep as-is if imported as JSX)
  src/components/docs/ElevenLabsIntegration.md.jsx →  .md
  src/components/manual.md.jsx                     →  .md
```

**Validation:** `npm run lint && npm run typecheck && npm run build && npm test`

### 8.2 Tier 2 — shadcn/ui Components (mechanical conversion)

These 49 components follow a uniform pattern: thin wrappers around Radix UI primitives. Many already have implicit types from `@radix-ui/*`. Conversion is mechanical — add `React.ComponentPropsWithoutRef<>` or `React.HTMLAttributes<>` types.

```
src/components/ui/dialog.jsx             →  .tsx
src/components/ui/menubar.jsx            →  .tsx
src/components/ui/toggle-group.jsx       →  .tsx
src/components/ui/command.jsx            →  .tsx
src/components/ui/radio-group.jsx        →  .tsx
src/components/ui/breadcrumb.jsx         →  .tsx
src/components/ui/calendar.jsx           →  .tsx
src/components/ui/carousel.jsx           →  .tsx
src/components/ui/form.jsx               →  .tsx
src/components/ui/context-menu.jsx       →  .tsx
src/components/ui/select.jsx             →  .tsx
src/components/ui/dropdown-menu.jsx      →  .tsx
src/components/ui/toast.jsx              →  .tsx
src/components/ui/table.jsx              →  .tsx
src/components/ui/sidebar.jsx            →  .tsx   (653 lines — largest UI component)
src/components/ui/input-otp.jsx          →  .tsx
src/components/ui/toaster.jsx            →  .tsx
src/components/ui/popover.jsx            →  .tsx
src/components/ui/tabs.jsx               →  .tsx
src/components/ui/pagination.jsx         →  .tsx
src/components/ui/use-toast.jsx          →  .tsx   (hook, rename to .ts)
src/components/ui/chart.jsx              →  .tsx
src/components/ui/alert-dialog.jsx       →  .tsx
src/components/ui/tooltip.jsx            →  .tsx
src/components/ui/scroll-area.jsx        →  .tsx
src/components/ui/sheet.jsx              →  .tsx
src/components/ui/label.jsx              →  .tsx
src/components/ui/navigation-menu.jsx    →  .tsx
src/components/ui/resizable.jsx          →  .tsx
(+ remaining ui/*.jsx files)
```

**Strategy:** Batch-convert in groups of ~10. Run full validation after each batch.

### 8.3 Tier 3 — Frontend JS Logic Files (types matter most here)

These files contain business logic and benefit most from TypeScript's type safety.

```
src/api/client.js                            →  .ts    (836 lines — heavily used singleton)
src/utils/timeslotUtils.js                   →  .ts    (234 lines)
src/components/schedule/autoFillEngine.js    →  .ts    (1,961 lines — large, complex algorithms)
src/components/schedule/costFunction.js      →  .ts    (638 lines)
src/components/schedule/aiAutoFillEngine.js  →  .ts    (323 lines)
```

**Special attention:**

- `client.js` is imported by almost every component — must update all import paths.
- `autoFillEngine.js` at 1,961 lines is the 2nd largest frontend file. Consider splitting during conversion.
- These files have existing tests that will catch regressions.

### 8.4 Tier 4 — Application Components (by feature area)

Convert feature-by-feature to keep related types consistent within each area.

**Batch A — Auth & Layout (entry points):**

```
src/App.jsx                              →  .tsx
src/Layout.jsx                           →  .tsx
src/main.jsx                             →  .tsx
src/master-main.jsx                      →  .tsx
src/components/AuthProvider.jsx          →  .tsx
src/components/ThemeProvider.jsx         →  .tsx
src/components/NotificationManager.jsx   →  .tsx
src/master/MasterApp.jsx                 →  .tsx
src/master/MasterAuthProvider.jsx        →  .tsx
src/master/MasterLayout.jsx              →  .tsx
```

**Batch B — Settings & Admin:**

```
src/components/settings/WorkplaceConfigDialog.jsx    →  .tsx  (1,188 lines)
src/components/settings/ShiftTimeRuleManager.jsx     →  .tsx  (821 lines)
src/components/settings/TeamRoleSettings.jsx         →  .tsx  (569 lines)
src/components/settings/QualificationSettings.jsx    →  .tsx
src/components/settings/HolidayRuleSettings.jsx      →  .tsx
src/components/settings/SettingsPage.jsx             →  .tsx
(+ remaining settings/*.jsx)
src/components/admin/UserManagement.jsx              →  .tsx  (615 lines)
src/components/admin/ServerTokenManager.jsx          →  .tsx  (781 lines)
src/components/admin/TimeslotEditor.jsx              →  .tsx  (561 lines)
src/components/admin/AdminDashboard.jsx              →  .tsx
src/components/admin/SystemSettings.jsx              →  .tsx
src/components/admin/DataExplorer.jsx                →  .tsx
```

**Batch C — Schedule (highest risk — most complex):**

```
src/components/schedule/ScheduleToolbar.jsx          →  .tsx
src/components/schedule/ScheduleSidebar.jsx          →  .tsx
src/components/schedule/ScheduleBoard.jsx            →  .tsx  (4,588 lines — THE monolith)
(+ remaining schedule/*.jsx)
```

**Batch D — Feature areas (vacation, wishlist, staff, training, statistics, docs):**

```
src/components/vacation/*.jsx         →  .tsx  (4 files)
src/components/wishlist/*.jsx         →  .tsx  (4 files)
src/components/staff/*.jsx            →  .tsx  (4 files)
src/components/training/*.jsx         →  .tsx  (2 files)
src/components/statistics/*.jsx       →  .tsx  (4 files)
src/components/validation/*.jsx       →  .tsx  (4 files)
src/components/CoWorkWidget.jsx       →  .tsx  (1,096 lines)
src/components/GlobalVoiceControl.jsx →  .tsx  (761 lines)
src/lib/VisualEditAgent.jsx           →  .tsx  (655 lines)
```

**Batch E — Pages:**

```
src/pages/Help.jsx                    →  .tsx  (1,050 lines)
src/pages/Vacation.jsx                →  .tsx  (983 lines)
src/pages/MyDashboard.jsx             →  .tsx  (981 lines)
src/pages/ServiceStaffing.jsx         →  .tsx  (877 lines)
src/pages/Training.jsx                →  .tsx  (779 lines)
src/pages/Statistics.jsx              →  .tsx  (541 lines)
src/pages/WishList.jsx                →  .tsx  (507 lines)
(+ remaining pages/*.jsx)
```

**Batch F — Master pages:**

```
src/master/pages/MasterCentralEmployeeDetail.jsx  →  .tsx  (691 lines)
src/master/pages/MasterEmployeeDetail.jsx         →  .tsx  (661 lines)
src/master/pages/MasterEmployeeList.jsx           →  .tsx  (655 lines)
src/master/pages/MasterHolidays.jsx               →  .tsx  (579 lines)
(+ remaining master/**/*.jsx)
```

### 8.5 Tier 5 — Server Backend Conversion

Server files use CommonJS (`require`/`module.exports`). Conversion involves:

1. Rename `.js` → `.ts`
2. Add types to function parameters and Express handlers (`Request`, `Response`, `NextFunction`)
3. Replace `require()` with `import` statements (or keep CommonJS with typed signatures)
4. Update `server/tsconfig.json` to `checkJs: true` and remove `allowJs` once complete

**Note:** Server currently runs as plain JS via `node`. After conversion, either:

- **Option A (recommended):** Use `tsx` or `ts-node` for development, compile to JS for production
- **Option B:** Keep `allowJs: true`, rename files, and add types incrementally without changing the runtime

```
Server routes (largest first):
  server/routes/master.js           →  .ts  (1,476 lines)
  server/routes/aiAutofill.js       →  .ts  (735 lines)
  server/routes/auth.js             →  .ts  (500 lines)
  server/routes/staff.js            →  .ts  (483 lines)
  server/routes/admin/tools.js      →  .ts  (453 lines)
  server/routes/dbProxy/operations.js → .ts (446 lines)
  server/routes/holidays.js         →  .ts  (403 lines)
  server/routes/admin/system.js     →  .ts  (370 lines)
  server/routes/admin/dbTokens.js   →  .ts  (339 lines)
  server/routes/schedule.js         →  .ts  (330 lines)
  server/routes/admin/migrations.js →  .ts  (312 lines)
  server/routes/atomic.js           →  .ts  (286 lines)
  server/routes/dbProxy/tables.js   →  .ts  (250 lines)
  server/routes/admin.js            →  .ts  (router index)
  server/routes/dbProxy.js          →  .ts  (router index)
  server/routes/calendar.js         →  .ts
  server/routes/voice.js            →  .ts

Server infrastructure:
  server/index.js                   →  .ts  (229 lines)
  server/config.js                  →  .ts  (93 lines)
  server/startup.js                 →  .ts  (284 lines)
  server/db/pool.js                 →  .ts  (316 lines)
  server/middleware/*.js             →  .ts  (5 files)
  server/utils/*.js                 →  .ts  (9 files)

Server scripts:
  server/scripts/*.js               →  .ts  (4 files)
  server/migrateUsers.js            →  .ts
  server/runMigration.js            →  .ts
```

### 8.6 Tier 6 — Test File Conversion

Convert test files last, alongside or after their source files are converted.

```
  src/utils/__tests__/timeslotUtils.test.js     →  .test.ts
  src/utils/__tests__/wishRange.test.js         →  .test.ts
  src/api/__tests__/client.test.js              →  .test.ts
  src/components/schedule/__tests__/*.test.jsx  →  .test.tsx
  server/utils/__tests__/*.test.js              →  .test.ts
  server/middleware/__tests__/*.test.js         →  .test.ts
  server/routes/__tests__/*.test.js             →  .test.ts
  test/setup.js                                 →  .ts
```

### 8.7 Conversion Strategy Per File

For each file:

1. **Rename** the file extension (`.js` → `.ts`, `.jsx` → `.tsx`)
2. **Add explicit types** to function parameters, return values, and state
3. **Replace `any`** with proper types from `src/types/` or create new ones as needed
4. **Fix type errors** — `tsc --noEmit` must pass
5. **Update imports** in consuming files if the bundler doesn't auto-resolve (Vite usually does for frontend)
6. **Run full validation** after each batch: `npm run lint && npm run typecheck && npm run build && npm test`

**Rules:**

- Never convert more than ~10–15 files before running validation
- Prefer `unknown` over `any` when the type isn't immediately clear
- Use `// TODO: type this properly` comments sparingly for complex legacy patterns
- Do NOT refactor logic during conversion — only add types
- Keep the conversion commit separate from any behavioral changes

### 8.8 Success Criteria

| Metric                                       | Target                          |
| -------------------------------------------- | ------------------------------- |
| Frontend `.js`/`.jsx` files remaining        | 0 (excluding `.md.jsx` → `.md`) |
| Server `.js` files remaining                 | 0                               |
| `strict: true` in all tsconfig files         | ✅                              |
| `allowJs: false` in all tsconfig files       | ✅ (endgame)                    |
| `npm run typecheck` passing                  | ✅                              |
| `npm run build` passing                      | ✅                              |
| `npm test` passing                           | ✅                              |
| No new `any` types without `// TODO` comment | ✅                              |

### Phase 8 Deliverables

| Deliverable                        | Risk        | Validation                        |
| ---------------------------------- | ----------- | --------------------------------- |
| Tier 1: Quick wins (~30 files)     | None        | Build + typecheck                 |
| Tier 2: shadcn/ui (~49 files)      | Low         | Mechanical, patterns established  |
| Tier 3: Logic files (~5 files)     | Medium      | Tests + build                     |
| Tier 4: App components (~90 files) | Medium      | Tests + build + manual smoke test |
| Tier 5: Server backend (~45 files) | Medium-High | Tests + Docker compose + Railway  |
| Tier 6: Test files (~12 files)     | Low         | Tests still pass                  |

---

## 12. Risk Register

| Risk                                                        | Likelihood | Impact   | Mitigation                                                            |
| ----------------------------------------------------------- | ---------- | -------- | --------------------------------------------------------------------- |
| ScheduleBoard refactoring breaks scheduling                 | High       | Critical | Write tests first, decompose incrementally, A/B test in staging       |
| TypeScript conversion introduces type errors that mask bugs | Medium     | High     | Use `strict: true` from day one, convert small files first            |
| TypeScript conversion breaks import resolution              | Medium     | Medium   | Vite resolves TS natively; validate after each batch of 10-15 files   |
| Railway deployment breaks                                   | Low        | Critical | CI pipeline tests build before merge; never change Railway config     |
| Multi-tenant data leak during refactoring                   | Low        | Critical | Don't change tenant isolation logic; add integration tests first      |
| Team velocity drops during migration                        | High       | Medium   | Do not attempt all phases at once; Phase 0+1 can be completed quickly |
| Merge conflicts with feature development                    | Medium     | Medium   | Small PRs, communicate refactoring schedule with team                 |

---

## 13. File Inventory — Critical Refactoring Targets

### Frontend — Files Over 500 Lines (Must Split)

| File                                            | Lines | Target After Split                      |
| ----------------------------------------------- | ----- | --------------------------------------- |
| `components/schedule/ScheduleBoard.jsx`         | 4,743 | 5-7 files × ~400 lines                  |
| `components/schedule/autoFillEngine.js`         | 1,832 | 3 files + test suite                    |
| `components/CoWorkWidget.jsx`                   | 925   | 2-3 sub-components                      |
| `pages/Help.jsx`                                | 882   | Content sections as separate components |
| `pages/Vacation.jsx`                            | 866   | Extract VacationTable, VacationForm     |
| `pages/MyDashboard.jsx`                         | 848   | Extract DashboardCards, DashboardCharts |
| `components/settings/WorkplaceConfigDialog.jsx` | 842   | Use FormDialog abstraction              |
| `components/admin/ServerTokenManager.jsx`       | 738   | Extract TokenList, TokenForm            |
| `pages/Training.jsx`                            | 726   | Extract TrainingTable, TrainingForm     |
| `pages/ServiceStaffing.jsx`                     | 722   | Extract StaffingTable, StaffingFilters  |
| `api/client.js`                                 | 701   | Split by domain (auth, db, schedule)    |

### Backend — Files Over 500 Lines (Must Split)

| File                           | Lines | Target After Split                                     |
| ------------------------------ | ----- | ------------------------------------------------------ |
| `routes/master.js`             | 1,371 | 3 modules (aggregation, employees, holidays)           |
| `routes/admin.js`              | 1,328 | 4 modules (tokens, integrity, migrations, operations)  |
| `routes/dbProxy.js`            | 853   | 4 modules (operations, validators, sentinels, cache)   |
| `index.js`                     | 805   | Extract middleware, db, startup (~200 lines remaining) |
| `routes/aiAutofill.js`         | 673   | Extract AI logic from route handlers                   |
| `scripts/seed-local-docker.js` | 563   | Extract schema definitions, demo data generators       |

---

## 14. Appendix — Analysis Data

### 13.1 ESLint Error Breakdown

- **Total:** 278 problems (201 errors, 77 warnings)
- **Auto-fixable:** 186 (67%)
- **React Hooks violations:** 2 files (Staff.jsx, Statistics.jsx) — **runtime bugs**
- **Unused variables:** ~30 instances
- **Missing dependencies in useEffect:** ~15 instances

### 13.2 Frontend Directory Structure

```
src/                              # 43,933 lines across 180 files
├── api/                          # 1 file, 701 lines
├── components/
│   ├── admin/                    # 6 files, 2,726 lines
│   ├── auth/                     # 3 files
│   ├── docs/                     # 2 documentation components
│   ├── hooks/                    # 1 file (duplicate location!)
│   ├── schedule/                 # 10+ files, 7,197+ lines
│   ├── settings/                 # 8+ dialog components
│   ├── staff/                    # 3 files
│   ├── statistics/               # 4 report components
│   ├── training/                 # 2 dialog components
│   ├── ui/                       # 26+ shadcn primitives
│   ├── utils/                    # 1 file (misplaced!)
│   ├── validation/               # 3 validation components
│   ├── vacation/                 # 2 vacation components
│   └── wishlist/                 # 2 dialog components
├── hooks/                        # 2 files (canonical location)
├── lib/                          # 2 files
├── master/                       # 5 files (master admin pages)
├── pages/                        # 14 page components
└── utils/                        # 1 file (empty .ts)
```

### 13.3 Backend Route Summary

| Route           | Lines     | Endpoints | Auth         |
| --------------- | --------- | --------- | ------------ |
| `/api/auth`     | 472       | 12        | Partial      |
| `/api/db`       | 853       | 6 (CRUD)  | Required     |
| `/api/schedule` | 296 + 673 | 8         | Required     |
| `/api/holidays` | 366       | 5         | Public reads |
| `/api/staff`    | 443       | 6         | Required     |
| `/api/admin`    | 1,328     | 15+       | Admin only   |
| `/api/master`   | 1,371     | 20+       | Admin only   |
| `/api/atomic`   | 285       | 2         | Required     |
| `/api/voice`    | 51        | 1         | Required     |
| `/api/calendar` | 40        | 2         | Required     |

### 13.4 Dependency Summary

**Frontend (package.json):**

- 30 production dependencies, ~95% unpinned (caret ranges)
- Key: React 18, React Router 6, TanStack Query 5, Tailwind 3, Radix UI, date-fns
- Notable: `recharts`, `jspdf`, `exceljs` for reporting

**Backend (server/package.json):**

- 14 production dependencies
- Key: Express, mysql2, jsonwebtoken, bcryptjs, nodemailer, helmet, cors
- Notable: `node-cron` for scheduled tasks, `jitsi-meet-jwt` for voice

---

## Recommended Execution Order

```
Phase 0 (Foundation)     ████████░░░░░░░░░░░░░░░░  — DONE ✅
Phase 1 (Quality)        ░░░░████████░░░░░░░░░░░░  — DONE ✅
Phase 2 (TS Foundation)  ░░░░░░░░████████░░░░░░░░  — DONE ✅ (infra + shared types)
Phase 3 (Frontend Arch)  ░░░░░░░░░░░░████████░░░░  — DONE ✅
Phase 4 (Backend Arch)   ░░░░░░░░░░░░████████░░░░  — DONE ✅
Phase 5 (Testing)        ░░░░░░██████████████░░░░  — DONE ✅
Phase 6 (Security)       ░░░░░░░░░░░░░░██████░░░░  — DONE ✅
Phase 7 (DX)             ░░░░░░░░░░░░░░░░████░░░░  — Not started
Phase 8 (TS Conversion)  ░░░░░░░░░░░░░░░░░░██████  — NEXT: bulk file conversion
```

> **Key insight:** Phases 0–6 established safety rails, architecture, tests, and security. Phase 8 is now safe to execute because the codebase is well-tested, well-structured, and the TypeScript infrastructure is already in place. The conversion is primarily mechanical — adding types to existing code without changing logic.

---

_Generated from automated codebase analysis. Last updated: 2025._
