## Pre-PR 4.0: Settings + Admin Smoke Tests (11 tests, ~400 lines)

### Goal
Create 2 smoke test files to protect rendering and basic interactions before TypeScript conversion of Settings + Admin components (Phase 4).

### Strategy
- **Pattern**: Follow `TenantGroupManagement.test.jsx` — `vi.hoisted` mocks, mock `@/api/client`, use `renderWithProviders`
- **Dialog handling**: Mock `@/components/ui/dialog` and `alert-dialog` to always render children (no portals), matching the ScheduleBoardRender dropdown-menu mock pattern
- **Rendering**: `renderWithProviders({ withAuthProvider: false, withToaster: false })`
- **Auth**: Mock `@/components/AuthProvider` (useAuth hook) in admin tests

---

### File 1: `src/components/settings/__component_tests__/SettingsDialogs.test.jsx` (~200L, 6 tests)

**File-level mocks:**
| Module | Reason |
|--------|--------|
| `@/api/client` | Mock `db.*` entities (Workplace, SystemSetting, TeamRole, ColorSetting) with `vi.fn()` |
| `@/hooks/useQualifications` | QualificationManagement uses this hook — mock to return test data |
| `@/components/settings/TeamRoleSettings` | Passthrough with overridable `useTeamRoles` (needed by ColorSettingsDialog, but must not break test 3's real component) |
| `sonner` | Mock toast |
| `@/components/ui/dialog` | Inline rendering: `Dialog → <>{children}</>` |
| `@/components/ui/alert-dialog` | Inline rendering |
| `@/components/admin/TimeslotEditor` | Stub (sub-component of WorkplaceConfigDialog) |
| `@/components/settings/WorkplaceQualificationEditor` | Stub |

**Tests:**

1. **WorkplaceConfigDialog — renders with workplaces, tabs, and form fields visible**
   - `Workplace.list` → 1 workplace in "Rotationen"; `SystemSetting.list` → `[]`
   - Render `<WorkplaceConfigDialog defaultTab="Rotationen" />`
   - Assert: title "Konfiguration: Arbeitsplätze & Dienste", tab "Rotationen", workplace "CT", "Neu anlegen" button

2. **WorkplaceConfigDialog — edit name field, save triggers update**
   - Same seed data
   - Click edit button (pencil icon) on workplace row → edit form appears
   - Assert: "Bezeichnung" input visible
   - Type new name, click save → assert `Workplace.update` called

3. **TeamRoleSettings — renders role list with badges**
   - `TeamRole.list` → seeded roles (Chefarzt, Oberarzt, Facharzt)
   - Render `<TeamRoleSettings />`
   - Assert: "Team-Funktionen verwalten", role names with badges (Facharzt, VG, HG), "Neue Funktion hinzufügen" button

4. **QualificationManagement — renders categories and qualification badges**
   - `useQualifications` → returns 2 quals in "Medizinisch" category
   - Render `<QualificationManagement />`
   - Assert: "Qualifikationen verwalten", category "Medizinisch" with count badge, qualification names, "Neue Qualifikation hinzufügen"

5. **ColorSettingsDialog — renders with color rows and tab labels**
   - `ColorSetting.list` → `[]`; `Workplace.list` → `[]`; `useTeamRoles` override → 3 role names
   - Render `<ColorSettingsDialog />`
   - Assert: "Farbeinstellungen", tab labels (Funktionen, Arbeitsplätze, Rotationen, Abwesenheiten, Bereiche), ColorRow with "Test" preview text

6. **SectionConfigDialog — renders section list with buttons**
   - `SystemSetting.list` → `[]`; `Workplace.list` → `[]`
   - Render `<SectionConfigDialog />`
   - Assert: "Panel-Konfiguration", section names (Abwesenheiten, Dienste, etc.), "Speichern" and "Zurücksetzen" buttons

---

### File 2: `src/components/admin/__component_tests__/AdminSmoke.test.jsx` (~200L, 5 tests)

**File-level mocks:**
| Module | Reason |
|--------|--------|
| `@/api/client` | Mock `api.*` methods (listUsers, request, updateUser, register, deleteUser) + `db.*` entities |
| `@/components/AuthProvider` | Mock `useAuth` → admin user with token; `AuthProvider` → passthrough |
| `@/components/dbTokenStorage` | Mock all functions (getActiveDbToken, saveDbToken, enableDbToken, etc.) |
| `sonner` | Mock toast |
| `@/components/ui/dialog` | Inline rendering |
| `@/components/admin/ServerTokenManager` | Stub (rendered as child of DatabaseManagement) |
| `@/components/staff/EmployeeSelect` | Stub (used by UserManagement) |
| `@/components/admin/UserPermissionsDialog` | Stub (used by UserManagement) |

**Tests:**

7. **UserManagement — renders with user list visible**
   - `api.listUsers` → 2 users; `api.request` → `[]`
   - Render `<UserManagement />`
   - Assert: `data-testid="admin-user-management"`, "Benutzerverwaltung", user email visible, "Neuer Benutzer" button

8. **UserManagement — create user dialog opens with form fields**
   - Same setup
   - Click "Neuer Benutzer" button
   - Assert: `data-testid="admin-user-create-dialog"` visible, email/name/password/role inputs present

9. **ServerTokenManager — renders with empty state**
   - `api.request` for `/api/admin/db-tokens` → `[]`; migration-status → `{ migrations: [], allApplied: true }`
   - Render `<ServerTokenManager />`
   - Assert: "Mandanten-Datenbanken", empty state "Keine Mandanten-Verbindungen konfiguriert", "Datenbank-Schema ist aktuell"

10. **DatabaseManagement — renders with tool cards and buttons**
    - `useAuth` → `{ token: 'test-jwt', user: adminUser }`; ServerTokenManager stubbed
    - Render `<DatabaseManagement />`
    - Assert: "MySQL-Modus aktiv", "Datenbank-Tools" card, "Datenbank leeren" button, "Integritätsprüfung" card, "Prüfung starten" button

11. **AdminSettings — renders with settings fields present**
    - `db.SystemSetting.list` → wish_deadline_months + wish_approval_rules settings; `db.Workplace.list` → `[]`
    - Render `<AdminSettings />`
    - Assert: `data-testid="admin-settings-panel"`, "System-Einstellungen", deadline input, "Genehmigungspflicht für Wünsche" section, approval switches

---

### Verification
```bash
npx vitest run --project component src/components/settings/__component_tests__/SettingsDialogs.test.jsx
npx vitest run --project component src/components/admin/__component_tests__/AdminSmoke.test.jsx
npm run test:all
```

All 11 tests must pass. Existing tests must not be affected.