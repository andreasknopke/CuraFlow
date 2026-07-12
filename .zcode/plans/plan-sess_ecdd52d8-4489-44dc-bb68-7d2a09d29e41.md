## Plan: Convert Remaining `.js`/`.jsx` Files to TypeScript

### Scope
**44 source files + 3 test-utils files** (~14,400 lines) plus cleanup of dead code and docs.

---

### Batch A — Dead code & docs cleanup (no type work needed)

| Action | File |
|--------|------|
| Delete | `src/api/entities.js` — dead code, exports `undefined` |
| Delete | `src/api/integrations.js` — dead code, exports `undefined` |
| Delete | `src/components/settings/AbsenceRulesDialog.jsx` — 0-byte empty stub |
| Rename | `src/components/docs/AuthMigrationPlan.md.jsx` → `.md` (pure markdown) |
| Rename | `src/components/docs/ElevenLabsIntegration.md.jsx` → `.md` (pure markdown) |
| Rename | `src/components/manual.md.jsx` → `.md` (pure markdown) |

### Batch B — Pure utility `.js` → `.ts` (17 files, ~4,020L)

All are pure logic modules with no JSX. No explicit `.js` extensions in any imports (source or test), so `git mv` is safe.

| File | Lines | Notes |
|------|------|-------|
| `src/components/schedule/poolShiftQueries.js` | 10 | Tiny |
| `src/components/settings/serviceTypes.js` | 6 | Tiny — const array |
| `src/components/wishlist/wishPreferences.js` | 10 | Tiny |
| `src/components/wishlist/wishQualificationFilter.js` | 23 | Tiny |
| `src/components/staff/centralLinkSync.js` | 39 | Async, imports `@/api/client` |
| `src/components/statistics/wishFulfillmentUtils.js` | 73 | Imports `@/utils/wishRange` |
| `src/components/schedule/scheduleShiftLookup.js` | 79 | |
| `src/components/schedule/sectionVisibility.js` | 97 | Uses `JSON.parse` |
| `src/components/schedule/timeslotSelectionUtils.js` | 104 | |
| `src/components/schedule/rowQualFilter.js` | 150 | Returns Tailwind strings |
| `src/components/training/trainingContractUtils.js` | 121 | Uses `date-fns` |
| `src/components/vacation/vacationBalance.js` | 307 | Complex but documented |
| `src/components/statistics/exportUtils.js` | 166 | Uses `jspdf` |
| `src/components/schedule/doctorWorkTime.js` | 135 | Clean destructuring |
| `src/components/schedule/costFunction.js` | 629 | Exports class + `WEIGHTS` |
| `src/components/schedule/aiAutoFillEngine.js` | 254 | Imports siblings |
| `src/components/schedule/autoFillEngine.js` | 1,964 | **Largest file** — imports from `costFunction`, `doctorWorkTime` |

These import from each other (`aiAutoFillEngine → autoFillEngine → costFunction/doctorWorkTime`) so convert in dependency order: leaves first (`costFunction`, `doctorWorkTime`, etc.), then `autoFillEngine`, then `aiAutoFillEngine`.

### Batch C — Non-JSX `.jsx` → `.ts` (3 files, 37L)

| File | Lines | Notes |
|------|------|-------|
| `src/components/db/index.jsx` | 4 | Barrel re-export |
| `src/components/utils/dbTracker.jsx` | 11 | No-op export |
| `src/components/hooks/useIsMobile.jsx` | 22 | Hook, no JSX |

### Batch D — React components `.jsx` → `.tsx` (22 files, ~7,652L)

All contain JSX. One explicit `.jsx` import to fix: `master-main.jsx` line 2 imports `@/master/MasterApp.jsx`.

| File | Lines |
|------|------|
| `src/master-main.jsx` | 7 |
| `src/master/MasterApp.jsx` | 105 |
| `src/master/MasterAuthProvider.jsx` | 127 |
| `src/master/MasterLayout.jsx` | 114 |
| `src/components/dashboard/CertificateExpiryWidget.jsx` | 128 |
| `src/master/pages/MasterDashboard.jsx` | 87 |
| `src/master/pages/MasterLogin.jsx` | 92 |
| `src/master/pages/MasterAdminPermissions.jsx` | 116 |
| `src/master/pages/MasterStaff.jsx` | 142 |
| `src/master/pages/MasterAbsences.jsx` | 183 |
| `src/master/pages/MasterTimeTracking.jsx` | 196 |
| `src/master/pages/MasterCostCenters.jsx` | 253 |
| `src/master/pages/MasterEmployeeCreate.jsx` | 299 |
| `src/master/pages/MasterWorkTimeModels.jsx` | 246 |
| `src/master/pages/MasterHolidays.jsx` | 525 |
| `src/master/pages/MasterTisoware.jsx` | 661 |
| `src/master/pages/MasterPayScaleTariffs.jsx` | 581 |
| `src/master/pages/MasterEmployeeDetail.jsx` | 693 |
| `src/master/pages/MasterEmployeeList.jsx` | 778 |
| `src/master/pages/MasterStammdatImport.jsx` | 886 |
| `src/master/pages/MasterCentralEmployeeDetail.jsx` | 1,263 |
| `src/master/pages/MasterPPUGV.jsx` | 1,276 |

### Batch E — Test utilities (3 files)

| File | Lines | Target |
|------|------|--------|
| `src/test-utils/renderWithProviders.jsx` | 51 | `.tsx` (has JSX) |
| `src/test-utils/server.js` | 240 | `.ts` |
| `src/test-utils/setup-tests.js` | 74 | `.ts` |

---

### Conversion pattern (same as PRs 6.1–6.4)
1. `git mv file.js file.ts` (or `.jsx` → `.tsx` / `.ts`)
2. Add type annotations: parameters, returns, interfaces, union types for state
3. No logic changes
4. Fix any import issues (only 1 known: `master-main.jsx` → `.tsx` explicit `.jsx` extension)

### Verification
- `npm run build` after each batch
- `npm run test:all` after each batch
- `npm run typecheck` at the end (Batches B–E enable `checkJs` coverage)

### Total: 47 file conversions/deletions/renames across 5 batches