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
| `src/types/` directory | Does not exist |
| `strict` mode | `false` in both `tsconfig.json` and `jsconfig.json` |
| Pre-existing TS errors | 4 (in `staffingUtils.ts`, `qualificationEvidence.ts`) |
| E2E test coverage | 34 tests total; 5 dedicated ScheduleBoard tests (auto-fill, rendering, toolbar, clear-day buttons, error check) |
| Drag-and-drop E2E coverage | None — Playwright mouse events cannot reliably trigger @hello-pangea/dnd drag operations. Drag-and-drop needs component-level tests with React Testing Library. |
| eslint covers .ts/.tsx | No — only `.js`/`.jsx`/`.mjs`/`.cjs` |
| Build status | `npm run build` passes |

## Execution Plan

### Phase 0: Groundwork — 3 PRs

**PR 0a — Fix pre-existing TS errors**

Fix the 4 type errors currently surfacing in `lib/qualificationEvidence.ts` and `utils/staffingUtils.ts`. These block clean `npm run typecheck` and would interfere with later strict-mode enforcement.

- Verify: `npm run typecheck` exits with zero errors

**PR 0b — Add missing E2E safety tests**

Add E2E tests for critical uncovered areas before conversion begins. The highest-priority target is ScheduleBoard (7k lines), the core of the app:

- **ScheduleBoard safety** (`e2e/specs/schedule/schedule-mutations.spec.ts`) — 5 tests: auto-fill preview + discard, seeded shift rendering, clear-day button visibility, toolbar elements presence, no "Datenbankproblem" toast. Requires `data-testid` additions to ScheduleBoard.jsx (auto-fill trigger, preview bar, preview apply/discard, clear-week, export).
- **Untested pages** (Home, Help, MyDashboard, DataImport, ServiceStaffing, CertificateUpload) — 6 smoke specs, one per page. Navigate and assert page rendered.

**Note:** Drag-and-drop (the core ScheduleBoard interaction) cannot be tested at the E2E level — Playwright mouse events do not reliably trigger `@hello-pangea/dnd`. Drag-and-drop needs component-level tests with React Testing Library and `@testing-library/user-event`, to be added before converting ScheduleBoard.jsx.

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
| 0 | 0a | Fix pre-existing TS errors | 2-3 source files |
| 0 | 0b | Add E2E safety tests (ScheduleBoard + untested pages) | ~7 new spec files + ScheduleBoard testid additions |
| 0 | 0c | Update eslint + jsconfig for .tsx | 2 config files |
| 1 | 1 | Create `src/types/` | 4 new files |
| 2 | 2 | Convert Schedule, Home, Admin, CertificateUpload | 4 renames + type imports |
| 2 | 3 | Convert AuthLogin, DataImport, Statistics | 3 renames + type imports |
| 2 | 4 | Convert Staff, Training, Help | 3 renames + type imports |
| 2 | 5 | Convert MyDashboard, ServiceStaffing, Vacation, WishList | 4 renames + type imports |
| 3 | 6 | Convert `pages.config.js` → `pages.config.ts` | 1 rename + import update |
| 4 | 7 | Enable `strict: true` | 1 config change + fixes across pages |

**Total: 9 PRs (pages only).** Each PR is independently verifiable via `npm run build && npm run typecheck && npm run test:e2e`.

For **component conversion** (ScheduleBoard, admin, settings, ui primitives — ~150 files, ~50k lines), a separate follow-up plan is needed with its own E2E + component test safety net.

## Verification Script

After each PR, run:

```bash
npm run build && npm run typecheck && npm run lint && npm run test:all && npm run test:e2e
```

A page conversion is only complete when all five steps pass with zero errors.

## Changes Made (Pre-Conversion)

- **ScheduleBoard testids added**: `schedule-auto-fill-trigger`, `schedule-auto-fill-all`, `schedule-preview-bar`, `schedule-preview-apply`, `schedule-preview-discard`, `schedule-clear-week`, `schedule-export`
- **SchedulePage POM extended**: New locators for auto-fill, preview, clear-week; `dragShiftOffGrid` method; updated `dragToTarget` with `locator.hover` approach
- **Schedule safety E2E tests**: 5 new tests in `e2e/specs/schedule/schedule-mutations.spec.ts`
- **E2E test fix**: Training rotation test updated to use relative dates (`addMonths(new Date(), 1)`) instead of static `seededSchedule.targetMonth`
- **AGENTS.md + copilot-instructions.md**: Updated CI Readiness section to include `npm run test:all` and `npm run test:e2e`
