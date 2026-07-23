// ---------------------------------------------------------------------------
// Master admin domain types — central employee management, tariffs, etc.
// All id fields are UUID strings (VARCHAR(36)) unless noted otherwise.
// All date/datetime fields are ISO strings from the DB (dateStrings: true).
// ---------------------------------------------------------------------------

// ── Tenant (from /api/admin/db-tokens) ────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
}

export interface TenantWithStatus extends Tenant {
  is_active?: boolean;
  description?: string;
  db_name?: string;
  host?: string;
}

// ── Central employee ──────────────────────────────────────────────────────

export interface CentralEmployee {
  id: string;
  last_name: string;
  first_name?: string | null;
  former_name?: string | null;
  title?: string | null;
  payroll_id?: string | null;
  date_of_birth?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  contract_type?: string | null;
  position?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  probation_end?: string | null;
  target_hours_per_week?: number | null;
  model_hours_per_week?: number | null;
  vacation_days_annual?: number | null;
  work_time_model_id?: string | null;
  payscale_tariff_id?: string | null;
  payscale_group_id?: string | null;
  payscale_level?: number | null;
  is_active: boolean;
  exit_date?: string | null;
  exit_reason?: string | null;
  notes?: string | null;
  created_date: string;
  updated_date: string;
}

export interface CentralEmployeeFormData {
  last_name: string;
  first_name: string;
  former_name: string;
  title?: string;
  payroll_id: string;
  date_of_birth: string;
  email: string;
  phone: string;
  address: string;
  contract_type: string;
  position?: string;
  contract_start: string;
  contract_end?: string;
  probation_end?: string;
  target_hours_per_week: number | string;
  vacation_days_annual: number | string;
  work_time_model_id: string;
  payscale_tariff_id?: string;
  payscale_group_id?: string;
  payscale_level?: string;
  is_active: boolean;
  exit_date?: string;
  exit_reason?: string;
  notes: string;
}

// ── Central employee assignment (tenant linkage) ──────────────────────────

export interface CentralEmployeeAssignment {
  id: string;
  central_employee_id: string;
  tenant_id: string;
  tenant_name: string;
  doctor_id: string;
  doctor_name: string;
  fte_share?: number | null;
  is_primary: boolean;
  created_date: string;
}

// ── Legacy staff entry (from tenant Doctor table) ─────────────────────────

export interface StaffEntry {
  id: string;
  tenantId: string;
  tenantName: string;
  name: string;
  role?: string | null;
  is_active: boolean;
  qualifications?: string | null;
  notes?: string | null;
  central_employee_id?: string | null;
}

/** Extended staff details returned by /api/master/staff/:tenant/:employee */
export interface StaffDetail extends StaffEntry {
  email?: string | null;
  phone?: string | null;
  payroll_id?: string | null;
  address?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  probation_end?: string | null;
  target_hours_per_week?: string | number | null;
  vk_share?: number | null;
  work_time_percentage?: number | null;
  special_status?: string | null;
  vacation_days_total?: number | null;
  vacation_days_taken?: number | null;
  vacation_days_planned?: number | null;
  remaining_vacation?: number | null;
  month_closed?: boolean | null;
  absences?: Array<{
    type: string;
    date: string;
    from?: string | null;
    to?: string | null;
    days?: number | null;
    note?: string | null;
  }>;
  current_month_actual?: number | null;
  overtime_balance?: number | null;
  time_accounts?: Array<{
    year: number;
    month: number;
    target_hours: number;
    actual_hours: number;
    delta_hours: number;
    is_closed: boolean;
  }>;
}

// ── Absence entry ─────────────────────────────────────────────────────────

export interface AbsenceEntry {
  tenantName: string;
  staffName: string;
  type: string;
  date: string;
  note?: string | null;
}

export interface AbsenceSummary {
  [absenceType: string]: number;
}

export interface AbsenceData {
  entries: AbsenceEntry[];
  summary: AbsenceSummary;
}

// ── Absence statistics (yearly, for charts) ───────────────────────────────

/** One month of aggregated absence days, keyed by absence type. */
export interface AbsenceMonthlyPoint {
  month: number; // 1–12
  label: string; // 'Jan', 'Feb', …
  days: { [absenceType: string]: number };
}

/** Response of GET /api/master/absence-stats?year=…&tenantId=… */
export interface AbsenceStatsData {
  monthly: AbsenceMonthlyPoint[];
  byType: { [absenceType: string]: number };
  staffCount: number;
}

// ── Time tracking entry ───────────────────────────────────────────────────

export interface TimeTrackingEntry {
  tenantName: string;
  staffName: string;
  role?: string | null;
  targetHours: number;
  actualHours: number;
  workDays: number;
}

export interface TimeTrackingSummary {
  staffCount: number;
  totalTargetHours: number;
  totalActualHours: number;
  totalDelta: number;
}

export interface TimeTrackingData {
  entries: TimeTrackingEntry[];
  summary: TimeTrackingSummary | null;
}

// ── Cost center ───────────────────────────────────────────────────────────

export interface CostCenterTenantLink {
  tenant_id: string;
  tenant_name: string;
}

export interface CostCenter {
  code: string;
  name: string;
  tenants: CostCenterTenantLink[];
}

export interface CostCenterData {
  cost_centers: CostCenter[];
  tenants: Tenant[];
}

// ── Work time model (master version, extended from models.ts) ────────────

export interface MasterWorkTimeModelForm {
  name: string;
  hours_per_week: number | string;
  hours_per_day: number | string;
  is_default: boolean;
  description: string;
}

// ── PayScale tariff ───────────────────────────────────────────────────────

export interface PayscaleTariff {
  id: string;
  name: string;
  short_name: string;
  default_weekly_hours?: number | null;
  default_vacation_days?: number | null;
  description?: string | null;
  group_count?: number | null;
  is_active?: boolean;
}

export interface PayscaleTariffForm {
  name: string;
  short_name: string;
  default_weekly_hours: number | string;
  default_vacation_days: number | string;
  description: string;
}

export interface PayscaleGroup {
  id: string;
  name: string;
  description?: string | null;
}

// ── Admin user (from listUsers) ───────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  full_name?: string | null;
  role: string;
  is_super_admin?: boolean;
  permissions?: Record<string, boolean> | null;
}

// ── Holiday settings ──────────────────────────────────────────────────────

export interface HolidaySettings {
  federal_state: string;
  [key: string]: unknown;
}

export interface HolidayEntry {
  date: string;
  name: string;
  start?: string;
  end?: string;
  [key: string]: unknown;
}

export interface CustomHolidayEntry {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  type: string;
  action?: string;
  [key: string]: unknown;
}

// ── PPUGV ─────────────────────────────────────────────────────────────────

export interface PPUGVStation {
  id: string;
  name: string;
  kennziffer?: string | null;
  [key: string]: unknown;
}

// ── Tisoware ──────────────────────────────────────────────────────────────

export interface TisowareConnectionStatus {
  connected: boolean;
  message?: string | null;
  [key: string]: unknown;
}

export interface TisowareTable {
  schema_name: string;
  table_name: string;
  full_name: string;
  row_count: number;
  [key: string]: unknown;
}

export interface TisowareSampleResult {
  rows: Record<string, unknown>[];
  columns: Array<{ name: string }>;
  rowCount: number;
  totalCount: number;
  offset: number;
  limit: number;
}

export interface TisowareColumn {
  column_name: string;
  data_type: string;
  [key: string]: unknown;
}

// ── Tisoware Import ───────────────────────────────────────────────────────

/** A raw PERSTAMM row enriched with CuraFlow match status. */
export interface TisowareImportEmployee {
  PSNR: number;
  PSPERSNR: string;
  PSVORNA: string;
  PSNACHNA: string;
  PSEINDAT?: string;
  PSAUSDAT?: string;
  PGNR?: string;
  QALNR?: string;
  KSTNR?: string;
  match_status: 'matched' | 'unmatched' | 'no_pspersnr';
  employee_id: string | null;
  employee_name: string | null;
  employee_active?: boolean;
}

/** Result of the employee-search endpoint. */
export interface TisowareEmployeeSearchResult {
  employees: TisowareImportEmployee[];
  stats: {
    total: number;
    matched: number;
    unmatched: number;
    no_pspersnr: number;
  };
}

/** A single new absence entry in the preview. */
export interface TisowareNewAbsence {
  employee_id: string;
  psPersNr: string;
  date: string;
  position: string;
  notePrefix: string;
  loanr: string;
  note: string | null;
}

/** A conflict entry in the preview. */
export interface TisowareConflict {
  employee_id: string;
  psPersNr: string;
  date: string;
  tisoware_position: string;
  existing_position: string;
  resolution: 'tisoware_wins' | 'central_wins' | 'unresolved';
  local_priority: number | null;
  central_priority: number | null;
  loanr: string;
}

/** Result of the preview endpoint. */
export interface TisowareImportPreview {
  total_source_employees: number;
  matched_employees: number;
  unmatched_employees: number;
  total_absence_rows: number;
  new_absences: TisowareNewAbsence[];
  conflicts: TisowareConflict[];
  already_exists: Array<{
    employee_id: string;
    psPersNr: string;
    date: string;
    position: string;
    loanr: string;
  }>;
  unparseable_dates: Array<{
    psPersNr: string;
    loanr: string;
    rawFrom: string;
    rawTo?: string;
    reason: string;
  }>;
  unmatched_details: Array<{
    PSPERSNR: string;
    PSVORNA: string;
    PSNACHNA: string;
    match_status: string;
  }>;
}

/** Result of the run endpoint. */
export interface TisowareImportResult {
  imported: number;
  skipped_existing: number;
  resolved_conflicts: number;
  unresolved_conflicts: number;
  unparseable_dates: number;
  errors_count: number;
  errors: Array<{
    psPersNr: string;
    date?: string;
    loanr?: string;
    position?: string;
    error: string;
  }>;
}

// ── Stammdat import ───────────────────────────────────────────────────────

export interface StammdatEmployee {
  stammdat_id: number;
  personalnummer: number;
  last_name: string;
  first_name: string;
  position?: string | null;
  cost_center?: string | null;
  cost_center_name?: string | null;
  email?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  is_active: boolean;
  cost_center_splits: number;
  existing_employee_id?: string | null;
  existing_first_name?: string | null;
  existing_last_name?: string | null;
  candidates?: Array<{ id: string; name: string }>;
}

export interface StammdatImportDecision {
  stammdat_id: number;
  action: 'apply' | 'skip';
  existing_employee_id?: string;
}

// ── Company info from settings ────────────────────────────────────────────

export interface CompanyInfo {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  [key: string]: unknown;
}
