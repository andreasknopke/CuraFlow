# Priority B: Type Safety Cleanup — 6 Files

## Prerequisite
Export the `ContractInfo` interface from `trainingContractUtils.ts` (currently private, needed by WishMonthOverview and TrainingOverview).

## File-by-file cleanup

### 1. `src/components/statistics/WorkingTimeReport.tsx` (18 `any`, easiest)
All types already imported (`Doctor`, `ShiftEntry`, `Workplace`, `WorkplaceTimeslot`) + local `DoctorWorkStats`. Replace callback params and cast removals. No new interfaces needed.

### 2. `src/components/staff/StaffingPlanTable.tsx` (11 `any`)
Already imports `Doctor`. Add imports for `StaffingPlanEntry`, `StaffingPlanNote`, `SystemSetting`. Define a local `StaffingPlanPayload` interface for the mutation payload. Replace callback params, `err: any` → `err: unknown`, remove `systemSettings as any[]` casts.

### 3. `src/components/training/TransferToSchedulerDialog.tsx` (28 `any`)
Add imports for `Doctor`, `ShiftEntry`, `TrainingRotation`, `StaffingPlanEntry`, `Workplace`. Define 3 local interfaces (`TransferEntry`, `SkippedEntry`, `TransferData`). Replace all callback params. Two shadcn/ui `as any` casts (RadioGroup/Checkbox) → use wrapper functions instead.

### 4. `src/components/wishlist/WishMonthOverview.tsx` (30 `any`)
Add imports for `Doctor`, `WishRequest`, `ShiftEntry`. Import `ContractInfo` from trainingContractUtils. Replace callback params. `let icon: any` → `React.ReactNode`, `let hatchStyle: any` → `React.CSSProperties`. Three `(api as any).updateMe(...)` casts remain — these are untyped API methods (acceptable, will be addressed in Priority F or later).

### 5. `src/components/training/TrainingOverview.tsx` (22 `any`)
Add imports for `Doctor`, `TrainingRotation`. Import `ContractInfo`. Replace callback params. `status: any` → `string | null`. `dragStart/dragCurrent: any` → `Date | null`. `let style: any` → `React.CSSProperties`. `customColors: any` → `Record<string, React.CSSProperties | string>`.

### 6. `src/components/CoWorkWidget.tsx` (36+ `any`, most complex)
Define local Jitsi types (`JitsiMeetExternalAPI`, `JitsiMeetExternalAPICtor`). Define cowork API response interfaces (`CoworkInvite`, `CoworkContact`, `CoworkInviteListResponse`, `CoworkSession`). Replace all `(window as any)`, `(api as any)`, `(import.meta as any)`, `error: any` → `error: unknown`, etc. Two shadcn workarounds get wrapper functions. Auth state union gets a local type.

## After all 6 files cleaned
1. Remove all 6 entries from ESLint allowlist in `eslint.config.js`
2. Run `npm run typecheck && npm run lint && npm run build && npm run test:all` — all must pass
3. Update `docs/TYPE_SAFETY_ENFORCEMENT_PLAN.md` — mark Priority B complete with table of what was done
4. Single commit: `refactor: replace any with proper types in Priority B files`

## Verification
- `npm run typecheck` → 0 errors
- `npm run lint` → 0 errors
- `npm run build` → pass
- `npm run test:all` → all tests pass