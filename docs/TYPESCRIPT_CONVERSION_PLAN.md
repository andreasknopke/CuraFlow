# TypeScript Conversion Plan

## Goal

Convert the CuraFlow frontend pages to TypeScript with strict checking, matching the state of the `modernize-app-pr` branch:

1. All 14 page components converted from `.jsx` → `.tsx` with proper type annotations
2. A `src/types/` directory with domain model, auth, and API types
3. `"strict": true` in `tsconfig.json`
4. `pages.config.js` → `pages.config.ts`

**Out of scope for this plan:** Component conversion (~150 `.jsx` files including ScheduleBoard.jsx at 7k lines), test file conversion, server TypeScript conversion. These require separate planning with their own safety nets.

## Current State

| Metric | Value |
|--------|-------|
| TS/TSX files already in `src/` | ~28 (App, Layout, hooks, api client, utils, contexts) |
| JSX pages unconverted | 14 files in `src/pages/` |
| JSX components unconverted | ~150 files (~50k lines); ScheduleBoard.jsx is 7k lines |
| `src/types/` directory | Created (4 files: models.ts, auth.ts, api.ts, index.ts) |
| `strict` mode | `false` |
| Pre-existing TS errors | 0 — all fixed in Phase 0 |
| E2E test coverage | 46 tests total; all 14 pages have smoke + schedule has 5 safety tests |
| Drag-and-drop E2E coverage | None — Playwright cannot trigger @hello-pangea/dnd. Needs component tests with React Testing Library. |
| eslint covers .ts/.tsx | No — `.ts,.tsx` requires `typescript-eslint` parser not yet installed |
| Build status | `npm run build` passes |
| Typecheck status | `npm run typecheck` passes with zero errors (`.tsx` now included in jsconfig) |
| Page smoke coverage | 14/14 pages have root `data-testid` and E2E smoke test |

## Progress

- [x] **Pre-work**: Training E2E test fix (static dates → relative dates)
- [x] **Pre-work**: ScheduleBoard testid additions + 5 safety E2E tests
- [x] **Phase 0 — Groundwork** (single PR)
  - [x] Fix 5 pre-existing TS errors in `.ts` files (`api/client.ts`, `lib/qualificationEvidence.ts`, `utils/staffingUtils.ts`)
  - [x] Fix 7 hidden TS errors in `.tsx` files uncovered by including `src/**/*.tsx` in typecheck (`App.tsx`, `AuthProvider.tsx`, `Layout.tsx`, `PlanUpdateListener.jsx`)
  - [x] Add root `data-testid` to 6 pages (Home, Help, MyDashboard, DataImport, ServiceStaffing, CertificateUpload)
  - [x] Add smoke E2E tests for 6 untested pages (`e2e/specs/smoke/page-smoke.spec.ts`)
  - [x] Update `jsconfig.json` to include `src/**/*.tsx` in typecheck scope
  - [x] Verify: `npm run typecheck` zero errors, `npm run build` passes, `npm run test:e2e` 46 passed
- [x] **Phase 1** — Create `src/types/` (models, auth, api, index — 4 files, ~430 lines)
- [ ] **PR 2** — Convert Schedule, Home, Admin, CertificateUpload
- [ ] **PR 3** — Convert AuthLogin, DataImport, Statistics
- [ ] **PR 4** — Convert Staff, Training, Help
- [ ] **PR 5** — Convert MyDashboard, ServiceStaffing, Vacation, WishList
- [ ] **PR 6** — Convert `pages.config.js` → `pages.config.ts`
- [ ] **PR 7** — Enable `strict: true`

## Execution Plan

### ✅ Phase 0: Groundwork — Complete

All groundwork done in a single PR:

1. Fix 12 pre-existing/hidden TS errors across 5 files (`.ts` and `.tsx`)
2. Add `data-testid` to 6 untested pages + E2E smoke tests
3. Add ScheduleBoard testids + 5 ScheduleBoard safety E2E tests
4. Fix training rotation E2E test (static → relative dates)
5. Add `src/**/*.tsx` to `jsconfig.json` typecheck scope
6. Update AGENTS.md/copilot-instructions.md with E2E verification

**Verification:** `npm run typecheck` zero errors, `npm run build` passes, 46 E2E tests pass.

### ✅ Phase 1: Type Foundation — Complete

Created `src/types/` with four files ported from `modernize-app-pr` and adapted to master's schema:

```
src/types/
  index.ts      — barrel export
  models.ts     — Doctor, ShiftEntry, Workplace, StaffingPlanEntry, ScheduleBlock,
                  Qualification, WishRequest, SystemSetting, ShiftTimeRule,
                  WorkTimeModel, ColorSetting, TrainingRotation, CustomHoliday,
                  TeamRole, WorkplaceTimeslot, ScheduleNote, StaffingPlanNote
  auth.ts       — AppUser, AuthUser, TokenPayload, LoginRequest, LoginResponse
  api.ts        — ApiError, DbListResponse, MutationResponse, HealthResponse,
                  ApiRequestOptions
```

Key additions beyond modernize-app-pr: `ScheduleBlock.type`, `Doctor.receive_email_notifications`, `Workplace.allows_absence_overlap`, `Qualification.requires_certificate`/`certificate_validity_months`, `AppUser.wish_default_position`, new entity types for `StaffingPlanNote`, `TrainingRotation`, `CustomHoliday`.

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

### Drag-and-Drop Testing Gap

The ScheduleBoard's core interaction — drag-and-drop assignment creation, movement, and deletion — is handled by `@hello-pangea/dnd`. This library relies on native DOM mouse events that Playwright's simulated mouse cannot reliably trigger. Multiple approaches were tested (raw `page.mouse` events, `element.dispatchEvent(MouseEvent)`, `locator.hover()` + `mouse.down()`) and none produced a working drag.

**Mitigation:** Before converting ScheduleBoard.jsx (Phase 5+), add Vitest component tests using React Testing Library. These run in a real JSDOM environment where `@hello-pangea/dnd` works correctly. The component tests should cover:

1. Drag sidebar doctor → cell creates a shift
2. Drag shift between cells moves the shift
3. Drag shift off grid deletes the shift
4. Row header drop creates Mo-Fr assignments
5. Undo reverts a drag-created shift

The E2E tests added in PR 0b cover rendering, auto-fill, and toolbar interactions.

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
| 0 | ✅ | Fix TS errors + E2E safety tests + jsconfig | ~15 files |
| 1 | ✅ | Create `src/types/` | 4 new files |
| 2 | 2 | Convert Schedule, Home, Admin, CertificateUpload | 4 renames + type imports |
| 2 | 3 | Convert AuthLogin, DataImport, Statistics | 3 renames + type imports |
| 2 | 4 | Convert Staff, Training, Help | 3 renames + type imports |
| 2 | 5 | Convert MyDashboard, ServiceStaffing, Vacation, WishList | 4 renames + type imports |
| 3 | 6 | Convert `pages.config.js` → `pages.config.ts` | 1 rename + import update |
| 4 | 7 | Enable `strict: true` | 1 config change + fixes across pages |

**Total: 7 PRs remaining (Phase 0 complete).** Each PR is independently verifiable via `npm run build && npm run typecheck && npm run test:e2e`.

## Verification Script

After each PR, run:

```bash
npm run build && npm run typecheck && npm run lint && npm run test:all && npm run test:e2e
```

A page conversion is only complete when all five steps pass with zero errors.
