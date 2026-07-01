# TypeScript Conversion Plan

## Goal

Convert the CuraFlow frontend from a JS/JSX/TS/TSX hybrid to the same state as the `modernize-app-pr` branch:

1. All 14 page components converted from `.jsx` → `.tsx` with proper type annotations
2. A `src/types/` directory with domain model, auth, and API types
3. `"strict": true` in `tsconfig.json`
4. `pages.config.js` → `pages.config.ts`

Components (schedule, admin, ui, etc.), test files, and the server remain in JS/JSX — out of scope for this plan.

## Current State

| Metric | Value |
|--------|-------|
| TS/TSX files already in `src/` | ~28 (App, Layout, hooks, api client, utils, contexts) |
| JSX pages unconverted | 14 files in `src/pages/` |
| `src/types/` directory | Does not exist |
| `strict` mode | `false` in both `tsconfig.json` and `jsconfig.json` |
| Pre-existing TS errors | 4 (in `staffingUtils.ts`, `qualificationEvidence.ts`) |
| E2E test coverage | 10 specs; 6 pages lack smoke tests (Home, Help, MyDashboard, DataImport, ServiceStaffing, CertificateUpload) |
| eslint covers .ts/.tsx | No — only `.js`/`.jsx`/`.mjs`/`.cjs` |
| Build status | `npm run build` passes |

## Execution Plan

### Phase 0: Groundwork — 3 PRs

**PR 0a — Fix pre-existing TS errors**

Fix the 4 type errors currently surfacing in `lib/qualificationEvidence.ts` and `utils/staffingUtils.ts`. These block clean `npm run typecheck` and would interfere with later strict-mode enforcement.

- Verify: `npm run typecheck` exits with zero errors

**PR 0b — Add missing E2E smoke tests**

Add one minimal Playwright spec per untested page. Each spec navigates to the page and asserts the page rendered without crashing. This creates a safety net before conversion touches those files.

- Pages to add: Home, Help, MyDashboard, DataImport, ServiceStaffing, CertificateUpload
- Verify: `npm run test:e2e` passes

**PR 0c — Update linting and type-checking config**

- Add `.ts` and `.tsx` patterns to `eslint.config.js` so converted files are linted
- Add `src/**/*.tsx` to the include array in `jsconfig.json` so converted pages get type-checked
- No code changes

- Verify: `npm run lint` runs against .tsx files; `npm run typecheck` surfaces type errors in converted files

### Phase 1: Type Foundation — 1 PR

**PR 1 — Create `src/types/`**

Port the four type files from `modernize-app-pr`, adapted to any schema changes master introduced:

```
src/types/
  index.ts      — barrel export
  models.ts     — Doctor, ShiftEntry, Workplace, StaffingPlanEntry, etc. (~231 lines)
  auth.ts       — AppUser, LoginResponse, AuthState, etc. (~91 lines)
  api.ts        — ApiError, DbListResponse, MutationResponse, etc. (~44 lines)
```

The domain models are derived from the MySQL schema, which has been stable. Minimal adaptation expected.

- Verify: `npm run typecheck` passes; `npm run build` passes; E2E tests unaffected (types are erased at runtime)

### Phase 2: Page Conversions — 4 PRs

Each PR renames `.jsx` → `.tsx` for a batch of pages and adds `import type` annotations. The conversion pattern is:

1. `git mv <file>.jsx <file>.tsx` (preserves git history)
2. Add `import type { ... } from '@/types'` for domain model types used in props/state
3. Remove `import React from 'react'` where unnecessary (React 17+ JSX transform)
4. Resolve any new type errors
5. No logic changes — only type annotations

| PR | Pages | Total Lines | E2E Coverage | Risk |
|----|-------|-------------|--------------|------|
| **2** | Schedule (11L), Home (69L), Admin (67L), CertificateUpload (152L) | ~300L | Admin, plus new smoke tests from PR 0b | Low — simple wrappers |
| **3** | AuthLogin (188L), DataImport (382L), Statistics (434L) | ~1000L | AuthLogin + Statistics + new smoke tests | Medium |
| **4** | Staff (520L), Training (747L), Help (880L) | ~2150L | Staff + Training + new smoke tests | Medium |
| **5** | MyDashboard (858L), ServiceStaffing (1033L), Vacation (1268L), WishList (1196L) | ~4355L | Vacation + WishList + new smoke tests | Highest — largest and most complex; placed last after pattern is established |

Verify per PR:
- `npm run build` passes
- `npm run typecheck` passes
- `npm run test:e2e` passes

### Phase 3: Infrastructure — 1 PR

**PR 6 — Convert `pages.config.js` → `pages.config.ts`**

Add full typing: `Record<string, ComponentType>`, `LayoutProps` interface, typed `pagesConfig` export. Update `App.tsx` if the import path changes (Vite resolves `.js`/`.ts` automatically, so migration is seamless).

- Verify: `npm run build` + `npm run typecheck` + `npm run test:e2e` all pass

### Phase 4: Strict Mode — 1 PR

**PR 7 — Enable `"strict": true`**

- Set `"strict": true` in `tsconfig.json`
- Fix all surfaced errors (implicit-any, strict-null-checks, etc.)
- By now, all pages are typed with explicit imports — strict mode primarily catches incomplete type annotations that `strict: false` let slide

- Verify: `npm run typecheck` passes; `npm run build` passes; `npm run test:e2e` passes

## Summary

| Phase | PR | Description | Files Changed |
|-------|----|-------------|---------------|
| 0 | 0a | Fix pre-existing TS errors | 2-3 source files |
| 0 | 0b | Add missing E2E smoke tests | ~6 new spec files |
| 0 | 0c | Update eslint + jsconfig for .tsx | 2 config files |
| 1 | 1 | Create `src/types/` | 4 new files |
| 2 | 2 | Convert Schedule, Home, Admin, CertificateUpload | 4 renames + type imports |
| 2 | 3 | Convert AuthLogin, DataImport, Statistics | 3 renames + type imports |
| 2 | 4 | Convert Staff, Training, Help | 3 renames + type imports |
| 2 | 5 | Convert MyDashboard, ServiceStaffing, Vacation, WishList | 4 renames + type imports |
| 3 | 6 | Convert `pages.config.js` → `pages.config.ts` | 1 rename + import update |
| 4 | 7 | Enable `strict: true` | 1 config change + fixes across pages |

**Total: 9 PRs.** Each PR is independently verifiable via `npm run build && npm run typecheck && npm run test:e2e`.

## Verification Script

After each PR, run:

```bash
npm run build && npm run typecheck && npm run lint && npm run test:e2e
```

A page conversion is only complete when all four steps pass with zero errors.
