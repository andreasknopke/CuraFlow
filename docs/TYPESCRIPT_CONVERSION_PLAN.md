# TypeScript Conversion Plan

## Goal

Convert all CuraFlow frontend code from JS/JSX to TypeScript with `strict: true`.

## Part 1 — Pages ✅ COMPLETE

All 14 page components converted `.jsx` → `.tsx`, `src/types/` created, `strict: true` enabled in `jsconfig.json`, `pages.config.js` → `pages.config.ts`.

5 pages deferred with `@ts-nocheck` (MyDashboard, ServiceStaffing, Vacation, WishList, Training) — blocked on TanStack Query v5 API migration and component prop types.

**Verification:** `npm run typecheck` zero errors with `strict: true`, `npm run build` passes, 46 E2E tests pass.

---

## Part 2 — Component Conversion (~140 files, ~33k lines)

### Risk Categories

| Risk | What it means | Example |
|------|---------------|---------|
| **Low** | Conversion is mechanical. Wrong type → obvious build error. E2E catches runtime issues. | UI primitives (thin Radix wrappers) |
| **Medium** | File has business logic. A wrong type could compile but misbehave at runtime. Tests provide partial safety. | Staff components, vacation, auth |
| **High** | Large file, complex logic, or zero test coverage for the interaction surface. A wrong type annotation could compile fine and break silently at runtime. | ScheduleBoard (7k lines, 1.7k of drag-and-drop, zero DnD tests) |

### What can go wrong during conversion

**Silent null safety mismatches.** A `.jsx` file handles `undefined` naturally. Adding `const doctor: Doctor = doctors.find(...)` compiles with `as Doctor` but crashes if the doctor is deleted. The original JS handled this implicitly.

**`.jsx` component prop rejection.** Every `.jsx` component using `React.forwardRef` resolves to `IntrinsicAttributes & RefAttributes<any>` in TypeScript — rejecting all custom props. A `global.d.ts` augmentation adds `children` and `className` to bridge this, but any component that needs `value`, `onChange`, `variant`, or `data-testid` passed to a `.jsx` child will fail until that child is converted.

**The refactoring trap.** During conversion, the impulse to "clean this up while I'm here" is dangerous. Renaming a variable used in `handleDragEnd` could silently break drag-and-drop. E2E tests don't cover drag-and-drop (Playwright cannot trigger `@hello-pangea/dnd`), so this breakage would be invisible.

**`@ts-nocheck` as a time bomb.** Adding `@ts-nocheck` to a converted file gains zero type safety — it's just a rename. The plan converts files with proper types, not `@ts-nocheck`, by ensuring their dependencies are typed first.

### Conversion Pattern

Each file follows a consistent conversion:

1. `git mv <file>.jsx <file>.tsx` (preserves git history)
2. Add `import type { ... } from '@/types'` for domain model types
3. Remove `import React from 'react'` where unnecessary (React 17+ JSX transform)
4. Type function parameters, hooks, and props
5. Resolve type errors — no `@ts-nocheck`
6. No logic changes — only type annotations

Verify per PR:
```bash
npm run build && npm run typecheck && npm run test:all && npm run test:e2e
```

---

### Phase 1: Quick Wins — Low Risk (3 PRs, ~60 files)

Establishes the conversion pattern on files where mistakes are caught immediately.

#### PR 1.1 — UI primitives batch 1 (~25 files, ~500 lines)

`button`, `input`, `label`, `badge`, `card`, `dialog`, `tabs`, `select`, `table`, `checkbox`, `switch`, `slider`, `textarea`, `progress`, `separator`, `skeleton`, `avatar`, `tooltip`, `hover-card`, `popover`, `dropdown-menu`, `context-menu`, `menubar`, `radio-group`, `toggle`

All thin Radix `forwardRef` wrappers with the same template. A single typing mistake breaks every page — caught immediately by E2E.

**Risk: Low.** No business logic. All 46 E2E tests cover these implicitly.

#### PR 1.2 — UI primitives batch 2 (~25 files, ~500 lines)

`sheet`, `drawer`, `scroll-area`, `resizable`, `accordion`, `pagination`, `breadcrumb`, `alert`, `alert-dialog`, `carousel`, `calendar`, `command`, `chart`, `form`, `input-otp`, `navigation-menu`, `sonner`, `sticky-horizontal-scrollbar`, `toggle-group`, `use-toast`, `toast`, `toaster`, `sidebar`, `collapsible`, `aspect-ratio`

**Risk: Low.** A few have custom logic (`sidebar`, `chart`, `calendar`, `sticky-horizontal-scrollbar`) — review those carefully.

#### PR 1.3 — Statistics + Validation (8 files, ~1,100 lines)

`ComplianceReport`, `WishFulfillmentReport`, `ChartCard`, `WorkingTimeReport`, `OverrideConfirmDialog`, `useShiftValidation`, `ShiftValidation`, `useOverrideValidation`

`ShiftValidation` has 14 unit tests. `exportUtils` and `wishFulfillmentUtils` have 9 unit tests combined. E2E covers statistics exports.

**Risk: Low.** Well-tested business logic, thin visual wrappers.

---

### Phase 2: Medium Risk — Test-Backed ✅ COMPLETE

Components with moderate complexity and good test backing.

#### PR 2.1 — Vacation (4 files, ~2,100 lines)

`DoctorYearView` (957L), `VacationOverview` (461L), `ConflictDialog` (212L), `WeekdayRecurrenceDialog` (281L)

22 unit tests for `vacationBalance`. E2E covers conflict resolution. Calendar rendering is untested but read-only — low mutation risk.

**Risk: Medium.** Calendar grid layout complexity. Business logic is well-tested.

#### PR 2.2 — Staff (6 files, ~2,800 lines)

`StaffingPlanTable` (691L), `CertificateManager` (921L), `QualificationOverview` (511L), `DoctorQualificationEditor` (297L), `DoctorForm` (441L), `EmployeeSelect` (165L)

DoctorForm and EmployeeSelect have component tests (5 tests). E2E covers staff CRUD. `centralLinkSync` has 3 unit tests.

**Risk: Medium.** Several large files. DoctorForm and StaffingPlanTable have complex mutation logic.

#### PR 2.3 — Auth + Training + WishList (11 files, ~2,200 lines)

`AccountMenu` (298L), `ForcePasswordChangeDialog` (129L), `TenantSelectionDialog` (214L), `JWTAuthProvider` (230L), `TransferToSchedulerDialog` (550L), `TrainingOverview` (316L), `TrainingMultiYearOverview` (310L), `WishYearView` (308L), `WishMonthOverview` (490L), `WishRequestDialog` (430L), `WishReminderStatus` (178L)

AuthProvider has 4 component tests. E2E covers auth flows, training transfers, and wishlist approval.

**Risk: Medium.** `JWTAuthProvider` (auth infrastructure) is the most critical file in this group.

#### PR 2.4 — Lib + Root infrastructure (8 files, ~1,400 lines)

`AuthContext` (154L), `PageNotFound` (74L), `VisualEditAgent` (656L), `NavigationTracker` (49L), `ErrorBoundary` (86L), `ThemeSelector` (78L), `themeConfig` (99L), `EnvironmentMigrationNotice` (51L)

**Risk: Medium.** `AuthContext` and `ErrorBoundary` are infrastructure-level — used everywhere. Both are small. `VisualEditAgent` is large but isolated.

---

### Phase 3: High Risk — ScheduleBoard & Dependencies (7 PRs, ~20 files, ~18k lines)

The core of the app. ScheduleBoard.jsx (7,000 lines) is the single largest and most complex file. Extensive testing will be added BEFORE any conversion to ensure safety.


#### ⚠️ Pre-PR 3.0A: Drag-and-drop test suite — INFEASIBLE (drop from plan)

> **Spike results (2026-07-04): DnD testing is not achievable in either
> available environment.** Two probe tests were written and run:
>
> 1. **Component environment (happy-dom) — FALSIFIED.**
>    `src/components/schedule/__component_tests__/ScheduleDragDrop.spike.test.jsx`
>    renders the full board, pins element layout, dispatches a complete
>    mousedown→mousemove→mouseup gesture, and asserts a shift chip appears.
>    Result: **`onDragEnd` never fires** (`invalidateQueries calls=0`).
>    Pangea's window listeners see the mousemove events, but without a layout
>    engine the library cannot resolve which droppable the pointer is over.
>    Not fixable with better test code — property of `@hello-pangea/dnd` +
>    happy-dom/jsdom.
>
> 2. **E2E keyboard DnD (real Chromium) — INPUT DISPATCH SOLVED, SPATIAL
>    NAVIGATION BLOCKED.** `e2e/specs/schedule/schedule-dnd-keyboard.spec.ts`
>    is a stable diagnostic. Deep investigation isolated three problems:
>    - **Input dispatch (SOLVED).** `page.keyboard.press('Space')` synthesizes
>      a click on the focused `<div role="button">` handle, and pangea
>      cancels any in-progress drag on click. Also, `new KeyboardEvent(...)`
>      leaves `keyCode=0`, but pangea reads `event.keyCode`. Fix: dispatch
>      raw `KeyboardEvent`s on `document.activeElement` with `keyCode`/
>      `which` overridden via `Object.defineProperty`. This makes lift,
>      move, AND drop fire correctly — `Drag Start` → arrow moves →
>      `Drag Operation Ended`, and `handleDragEnd` runs validation.
>    - **Spatial navigation (BLOCKER, not fixable without a library swap).**
>      With lift/move/drop working, the drop still never lands on the target
>      row. Pangea's `moveCrossAxis` (`state/move-in-direction/index.ts`)
>      resolves the next droppable by nearest center-distance from the
>      dragged item's start position. The sidebar sits left of the grid and
>      its vertical center aligns with the Abwesenheiten ("Urlaub") section,
>      so every ArrowRight/ArrowDown resolves to an Abwesenheiten cell. A
>      2-D sweep (ArrowDown 0..7 × ArrowRight 0..3) and pre-scrolling the
>      target cell into view both failed — every drop landed on `Pos=Urlaub`,
>      never on `Dienst Vordergrund`.
>
> 3. **E2E mouse DnD (real Chromium) — ALSO FAILS.** The existing
>    `SchedulePage.dragSidebarDoctorToCell` helper was never called by any
>    test; a probe against it returned `Drag Operation Ended {destination:
>    null}`. This matches the plan's original statement that "Playwright
>    cannot trigger `@hello-pangea/dnd`".
>
> **Revised plan for Phase 3 safety:** drop Pre-PR 3.0A entirely. ScheduleBoard
> stays **High risk** throughout conversion and is protected by:
> - Pre-PR 3.0B rendering component tests (still valid),
> - the 47 existing unit tests for schedule helpers (autoFillEngine 23,
>   staffingUtils 26, holidayUtils 32, costFunction, …),
> - manual DnD verification per PR (create/move/delete/undo), and
> - a strict conversion discipline: type annotations only, zero logic edits
>   inside `handleDragEnd`/`handleAutoFill`/`handleClearWeek`.
>
> The two spike files are kept as executable evidence and re-run anchors.

**Original plan (superseded):** Create a DnD test suite using Vitest + React Testing Library + `@testing-library/user-event` running the ScheduleBoard DnD lifecycle in JSDOM — ~~the ONLY environment where `@hello-pangea/dnd` works reliably~~ (false; see spikes above).

**Assignment creation (4 tests):**
1. Drag sidebar doctor to empty service cell → shift chip appears, API call made
2. Drag sidebar doctor to occupied cell → conflict dialog shown, override works
3. Drag sidebar doctor to inactive day cell → drop rejected, no shift created
4. Drag sidebar doctor to timeslot-enabled workplace → timeslot selection dialog appears

**Assignment movement (3 tests):**
5. Drag shift from Vordergrund to Hintergrund cell → shift moved, old cell empty
6. Ctrl+drag shift to new cell → shift copied, original remains
7. Drag shift to same cell (reorder) → shift order updated

**Assignment deletion (2 tests):**
8. Drag shift off grid → shift deleted, doctor reappears in Verfügbar
9. Drag rotation assignment to sidebar → rotation assignment deleted

**Row header (Mo-Fr) (2 tests):**
10. Drag doctor to Dienst Vordergrund row header → 5 shifts created (Mon-Fri)
11. Row header drop on week with existing conflicts → conflicting days skipped, others created

**Undo (2 tests):**
12. Create shift via drag, press Ctrl+Z → shift removed from grid and DB
13. Bulk Mo-Fr create via drag, press Ctrl+Z → all 5 shifts removed

**Auto-frei (2 tests):**
14. Drag doctor to service position with auto-frei → auto-frei entry created next day
15. Delete auto-frei-triggering shift → auto-frei entry cleaned up

**Preview/auto-fill (2 tests):**
16. Generate auto-fill preview, apply → preview shifts become real shifts
17. Generate auto-fill preview, discard → preview cleared, no shifts created

**Error handling (2 tests):**
18. API failure on shift create → optimistic rollback, shift disappears from UI
19. Network error during bulk operation → partial state handled, error toast shown

**Verification:** `npm run test:all` passes all 19 tests. Tests run in the `component` Vitest project (happy-dom environment).


#### ⚠️ Pre-PR 3.0B: ScheduleBoard rendering component tests ✅ COMPLETE

Test file: `src/components/schedule/__component_tests__/ScheduleBoardRender.test.jsx`

**Seeded data rendering (3 tests):**
1. Render with seeded shifts → 4 shift chips visible, matching seed data
2. Qualification warning icon on CT shift → `schedule-shift-qualification-warning` visible
3. Section headers visible → Dienste, Rotationen, Abwesenheiten, Anwesenheiten sections present

**View switching (2 tests):**
4. Switch to month view → compact grid renders, month label shown
5. Switch to day view → single-column grid, day label shown

**Toolbar interactions (2 tests):**
6. Click auto-fill → preview bar appears with Vorschläge count
7. Click undo button → button exists and is clickable

**Verification:** `npm run test:all` passes all 7 tests.

> **Implementation note:** DropdownMenu was mocked inline (`@/components/ui/dropdown-menu`)
> rather than mocking the Radix Portal at the primitives level. The Radix trigger
> relies on pointer events that happy-dom does not support, making `userEvent.click`
> on the trigger ineffective. Mocking the entire dropdown-menu module to render
> inline (same approach as `AccountMenu.test.jsx`) keeps dropdown items always
> visible in the DOM. Auto-fill is exercised by directly clicking the
> "Alle Kategorien" button in the inline mock.


#### PR 3.1 — Schedule sub-components (7 files, ~2,000 lines)

`DraggableShift` (334L), `DroppableCell` (136L), `DraggableDoctor` (95L), `FreeTextCell` (43L), `MobileScheduleView` (240L), `staffingUtils` (333L), `holidayUtils` (224L)

StaffingUtils has 20 unit tests. HolidayUtils has 22 tests. These are the building blocks that ScheduleBoard imports.

**Risk: Low.** Sub-components are thin. Core logic already has unit tests. DnD regressions require manual verification (automated DnD testing infeasible; see Pre-PR 3.0A).


#### PR 3.2 — Schedule dialogs + Voice (8 files, ~2,000 lines)

`PoolShiftEditDialog` (376L), `RotationDemandDialog` (213L), `RotationAssignmentDialog` (228L), `AutoFillSettingsDialog` (145L), `AIRulesDialog` (123L), `DemoSettingsDialog` (148L), `VoiceControl` (391L), `VoiceTrainingDialog` (276L)

RotationDemandDialog has 6 component tests. AutoFillEngine has 24 unit tests.

**Risk: Medium.** Dialogs are self-contained. DnD tests cover the integrations these dialogs participate in.


#### PR 3.3 — ScheduleBoard.jsx (1 file, 7,000 lines) 🔴

**Prerequisites complete:**
- ~~❌ 19 DnD component tests~~ — **DROPPED** (infeasible; see Pre-PR 3.0A spikes)
- ✅ 7 ScheduleBoard rendering tests covering seeded data, views, toolbar (Pre-PR 3.0B)
- ✅ 47 existing unit tests (autoFillEngine 24, staffingUtils 20, holidayUtils 22, etc.)
- ✅ All sub-components (3.1) and dialogs (3.2) already typed
- ✅ 5 E2E schedule safety tests covering rendering, auto-fill, toolbar, navigation

**Conversion approach:**
1. `git mv ScheduleBoard.jsx ScheduleBoard.tsx`
2. Add `import type` from `@/types` for all 15+ domain models
3. Type 14 `useQuery`/`useMutation` hooks with explicit return types
4. Add type annotations to `handleDragEnd` (1,700 lines), `handleAutoFill`, `handleClearWeek`, etc.
5. Run the 7 rendering component tests — must all pass
6. Run full E2E suite — must all pass
7. Manual DnD verification (create/move/delete/undo shift via drag) since automated DnD testing is infeasible

**Risk: High.** DnD interactions are the highest-risk conversion area with no automated test coverage. Type annotations only, zero logic edits inside `handleDragEnd`/`handleAutoFill`/`handleClearWeek`. Manual DnD verification required per PR.

---

### Phase 4: Settings + Admin — Medium-High Risk (5 PRs, ~20 files, ~7,500 lines)

Configuration components with zero component tests. Add smoke tests before converting to catch rendering regressions.

#### ⚠️ Pre-PR 4.0: Settings + Admin smoke tests (~400 lines)

Test files:
- `src/components/settings/__component_tests__/SettingsDialogs.test.jsx` (~200L)
- `src/components/admin/__component_tests__/AdminSmoke.test.jsx` (~200L)

**Settings dialogs (6 tests):**
1. `WorkplaceConfigDialog` — render with workplaces prop, form fields visible
2. `WorkplaceConfigDialog` — edit name field, submit triggers onSave callback
3. `TeamRoleSettings` — render with roles, add/remove role works
4. `QualificationManagement` — render, create qualification dialog opens
5. `ColorSettingsDialog` — render, color picker visible
6. `SectionConfigDialog` — render with sections, reorder buttons visible

**Admin smoke (5 tests):**
7. `UserManagement` — render with auth context, user list visible
8. `UserManagement` — create user dialog opens, form fields present
9. `ServerTokenManager` — render, token list visible (or empty state)
10. `DatabaseManagement` — render, optimization button visible
11. `AdminSettings` — render, settings fields present

**Verification:** `npm run test:all` passes all 11 tests.

#### PR 4.1 — Settings part 1 (5 files, ~2,300 lines)

`TeamRoleSettings` (498L), `ColorSettingsDialog` (310L), `SectionConfigDialog` (416L), `AppSettingsDialog` (318L), `QualificationManagement` (542L)

**Risk: Medium.** Smoke tests catch rendering failures and basic interactions.

#### PR 4.2 — Settings part 2 (4 files, ~2,100 lines)

`WorkplaceConfigDialog` (855L), `WorkplaceQualificationEditor` (201L), `ShiftTimeRuleManager` (459L), `AbsenceRulesDialog` (0L — empty file)

**Risk: Medium.** `WorkplaceConfigDialog` has a dedicated smoke test with form validation.

#### PR 4.3 — Admin part 1 (5 files, ~2,700 lines)

`UserManagement` (918L), `AdminSettings` (274L), `DatabaseManagement` (318L), `SystemLogs` (301L), `ServerTokenManager` (888L)

**Risk: Medium.** Smoke tests cover rendering. `UserManagement` has a dedicated smoke test.

#### PR 4.4 — Admin part 2 (6 files, ~3,900 lines)

`TenantGroupManagement` (1,753L), `TimeslotEditor` (545L), `SharedTimeslotEditor` (253L), `RotationGroupManagement` (884L), `WorkplaceLinkManagement` (280L), `SharedWorkplaceQualificationsDialog` (190L)

TenantGroupManagement has 3 existing component tests. Others covered by admin navigation E2E.

**Risk: Medium.**

---

### Phase 5: Master App — Separate Application (3 PRs, ~15 files, ~5,300 lines)

The master app (`master.html`, separate entry point) handles central employee management, time tracking, holidays, pay scales. Zero E2E tests, 2 existing component tests.

#### ⚠️ Pre-PR 5.0: Master app smoke tests (~200 lines)

Test file: `src/master/__component_tests__/MasterSmoke.test.jsx` (~200L)

**Master pages (6 tests):**
1. `MasterLogin` — render login form, email/password fields visible
2. `MasterDashboard` — render dashboard, navigation links present
3. `MasterEmployeeList` — render employee list, search bar visible
4. `MasterEmployeeDetail` — render with employee prop, fields populated
5. `MasterEmployeeCreate` — render create form, save button present
6. `MasterHolidays` — render holiday list, year selector visible

**Verification:** `npm run test:all` passes all 6 tests.

#### PR 5.1 — Master app small pages (8 files, ~1,800 lines)

`MasterLogin`, `MasterDashboard`, `MasterStaff`, `MasterHolidays`, `MasterAbsences`, `MasterPayScaleTariffs`, `MasterWorkTimeModels`, `MasterTimeTracking`, `MasterEmployeeCreate`

**Risk: Medium.** Smoke tests cover rendering for the most important pages.

#### PR 5.2 — Master app large pages + infra (7 files, ~3,500 lines)

`MasterEmployeeList` (778L), `MasterEmployeeDetail` (693L), `MasterCentralEmployeeDetail` (1,254L), `MasterPPUGV` (465L), `MasterAuthProvider` (114L), `MasterLayout` (109L), `MasterApp` (95L)

**Risk: Medium.** Smoke tests plus 2 existing component tests provide some safety.

---

### Phase 6: Root Components — Medium Risk (4 PRs, ~18 files, ~5,700 lines)

Infrastructure components used across the entire app. Zero direct tests but exercised implicitly by everything. Add targeted tests for the most critical ones.

#### ⚠️ Pre-PR 6.0: Root infrastructure tests (~300 lines)

Test files:
- `src/components/__tests__/dbTokenStorage.test.js` (~100L) — unit tests
- `src/components/__tests__/useHolidays.test.js` (~100L) — unit tests
- `src/components/__component_tests__/ErrorBoundary.test.jsx` (~100L) — component test

**dbTokenStorage (4 tests):**
1. `getActiveTokenId()` returns stored token
2. `getActiveDbToken()` returns stored credentials
3. `setActiveDbToken()` stores and retrieves correctly
4. `clearDbToken()` removes stored credentials

**useHolidays (3 tests):**
5. `useHolidays(2026)` returns holiday calculator for given year
6. `isPublicHoliday(new Date('2026-05-01'))` returns true (Testfeiertag)
7. `isSchoolHoliday` returns false for non-holiday date

**ErrorBoundary (2 tests):**
8. Renders children normally when no error
9. Renders fallback UI when child throws

**Verification:** `npm run test:all` passes all 9 tests.

#### PR 6.1 — Root utilities (5 files, ~1,300 lines)

`useHolidays` (55L), `useShiftLimitCheck` (120L), `useStaffingCheck` (75L), `useElevenLabsConversation` (387L), `dbTokenStorage` (448L)

**Risk: Medium.** `dbTokenStorage` has 4 unit tests, `useHolidays` has 3 unit tests.

#### PR 6.2 — Root widgets (5 files, ~2,200 lines)

`TicketDialog` (256L), `PlanUpdateListener` (241L), `GlobalVoiceControl` (704L), `CoWorkWidget` (925L), `UserNotRegisteredError` (30L)

**Risk: Medium.** Used everywhere. `ErrorBoundary` tests provide some confidence.

#### PR 6.3 — Docs components (3 files, ~1,200 lines)

`AuthMigrationPlan` (159L), `AuthMigrationPlan.md` (751L), `ElevenLabsIntegration.md` (442L), `manual.md` (197L)

**Risk: Low.** Static documentation pages, no business logic.

#### PR 6.4 — Remaining root files (3 files, ~800 lines)

`ThemeSelector` (78L), `themeConfig` (99L), `EnvironmentMigrationNotice` (51L), `PageNotFound` (74L), `NavigationTracker` (49L), `VisualEditAgent` (656L)

**Risk: Low.** Small files, passive components.

---

## Summary

| Phase | PRs | Files | Lines | Risk | Key Dependency |
|-------|-----|-------|-------|------|----------------|
| 1. Quick wins | 3 | ~60 | ~2,100 | Low | None |
| 2. Test-backed | 4 | ~30 | ~8,500 | Medium | Phase 1 UI types |
| 3. ScheduleBoard | 7 | ~20 | ~18,000 | **High** (no DnD test coverage achievable — see spikes) | Pre-PR 3.0B ✅ (rendering) + manual DnD verification |
| 4. Settings + Admin | 5 | ~20 | ~7,500 | Medium | Pre-PR 4.0 smoke tests |
| 5. Master app | 3 | ~15 | ~5,300 | Medium | Pre-PR 5.0 smoke tests |
| 6. Root components | 4 | ~18 | ~5,700 | Medium | Pre-PR 6.0 infrastructure tests |
| **Total** | **26** | **~163** | **~47,000** | | |

### Pre-Conversion Test Additions Required

| Pre-PR | What | Lines | Tests | When | Status |
|--------|------|-------|-------|------|--------|
| ~~3.0A~~ | ~~DnD test suite~~ — **DROPPED** (infeasible in both happy-dom and Chromium; see spikes) | — | — | — | — |
| 3.0B | ScheduleBoard rendering component tests (seeded data, views, toolbar) | ~200 | 7 | Before Phase 3 (ScheduleBoard) | ✅ Done |
| 4.0 | Settings + Admin smoke tests (dialogs, forms, CRUD) | ~400 | 11 | Before Phase 4 (Settings+Admin) | |
| 5.0 | Master app smoke tests (login, dashboard, employee list/create) | ~200 | 6 | Before Phase 5 (Master) | |
| 6.0 | Root infrastructure tests (dbTokenStorage, useHolidays, ErrorBoundary) | ~300 | 9 | Before Phase 6 (Root) | |
| **Total** | | **~1,100** | **33** | |

### Spikes (executed — results below)

Two probe tests were written and run to determine whether DnD testing is
achievable for ScheduleBoard. Both confirm it is not.

1. **Component-environment spike — FALSIFIED.**
   `src/components/schedule/__component_tests__/ScheduleDragDrop.spike.test.jsx`
   - Run: `npx vitest run --project component src/components/schedule/__component_tests__/ScheduleDragDrop.spike.test.jsx`
   - Result: sanity test passes (board + sidebar doctor + droppable cell render),
     but the drag test fails with `invalidateQueries calls=0` — `onDragEnd`
     never fires in happy-dom. Pangea cannot resolve a drop destination without
     a real layout engine.

2. **E2E keyboard-DnD spike — INPUT DISPATCH SOLVED, SPATIAL NAVIGATION BLOCKED.**
   `e2e/specs/schedule/schedule-dnd-keyboard.spec.ts` (stable, passing diagnostic)
   - Run: `npx playwright test e2e/specs/schedule/schedule-dnd-keyboard.spec.ts --project=chromium`
   - Result: the input-dispatch problems (synthesized-click cancel + `keyCode=0`)
     were fully solved by dispatching raw `KeyboardEvent`s with overridden
     `keyCode`/`which`. Lift, move, AND drop all fire and `handleDragEnd` runs.
     But pangea's `moveCrossAxis` resolves the next droppable by nearest
     center-distance, and the sidebar's vertical center aligns with the
     Abwesenheiten row — so every drop lands on `Pos=Urlaub`, never on
     `Dienst Vordergrund` (confirmed across a 2-D ArrowDown×ArrowRight sweep
     and a pre-scroll-into-view attempt). This is intrinsic to
     `@hello-pangea/dnd`'s keyboard movement + this grid layout. If the
     assertion ever flips, navigation has become viable and Pre-PR 3.0A can be
     revisited. The raw-KeyboardEvent dispatch technique is retained in the
     spike for any future attempt (e.g. after swapping to dnd-kit, which has
     deterministic keyboard navigation).


### Test Coverage After Completion

| Layer | Before | After |
|-------|--------|-------|
| Component tests | 8 files | ~15 files (+7) |
| Unit tests | 17 files | ~20 files (+3) |
| E2E tests | 12 specs (46 tests) | 12 specs (46 tests) |
| DnD-specific | 0 tests | 19 tests (dropped — infeasible) |
| Rendering tests | 0 tests | 7 tests ✅ |
| Settings smoke | 0 tests | 11 tests |
| Master app tests | 2 tests | 8 tests |
| Infrastructure tests | 0 tests | 9 tests |
| **Total Vitest** | **~646 tests** | **~698 tests (+52)** |

### Files Already Converted (Part 1)

14 pages `.tsx`, `pages.config.ts`, 28 infrastructure files (App, Layout, hooks, api client, utils, contexts), `src/types/` (4 files).

### Concurrent Development Safety

Each PR converts files within one directory. If another PR adds a new `.jsx` file in the same directory, the merge conflict is a simple rename — easy to resolve. The conversion pattern is proven after Phase 1, so other developers can follow it for any new files they introduce.
