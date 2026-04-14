// ---------------------------------------------------------------------------
// Core domain model types — derived from the MySQL schema.
// All id fields are UUID strings (VARCHAR(36)).
// All date/datetime fields are ISO strings from the DB (dateStrings: true).
// ---------------------------------------------------------------------------

// ── Audit / common fields ──────────────────────────────────────────────────

export interface Auditable {
  created_by?: string | null;
  created_date: string;
  updated_date: string;
}

// ── Doctor / staff ─────────────────────────────────────────────────────────

export interface Doctor extends Auditable {
  id: string;
  name: string;
  initials?: string | null;
  role?: string | null;
  color?: string | null;
  email?: string | null;
  google_email?: string | null;
  fte: number;
  target_weekly_hours?: number | null;
  contract_end_date?: string | null;
  exclude_from_staffing_plan: boolean;
  central_employee_id?: string | null;
  work_time_model_id?: string | null;
  order: number;
  is_active: boolean;
}

// ── Workplace ──────────────────────────────────────────────────────────────

export type ConsecutiveDaysMode = 'forbidden' | 'allowed' | 'preferred';

export interface Workplace extends Auditable {
  id: string;
  name: string;
  category: string;
  color?: string | null;
  active_days?: boolean[] | null;
  time?: string | null;
  allows_multiple: boolean;
  timeslots_enabled: boolean;
  default_overlap_tolerance_minutes: number;
  work_time_percentage: number;
  affects_availability: boolean;
  min_staff: number;
  optimal_staff: number;
  service_type?: number | null;
  consecutive_days_mode: ConsecutiveDaysMode;
  order: number;
  is_active: boolean;
}

// ── Shift ──────────────────────────────────────────────────────────────────

export interface ShiftEntry extends Auditable {
  id: string;
  doctor_id?: string | null;
  date: string;
  position: string;
  section?: string | null;
  timeslot_id?: string | null;
  note?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  break_minutes?: number | null;
  is_free_text: boolean;
  free_text_value?: string | null;
  order: number;
}

// ── Wish ───────────────────────────────────────────────────────────────────

export type WishType = 'service' | 'absence' | string;
export type WishPriority = 'low' | 'medium' | 'high';
export type WishStatus = 'pending' | 'approved' | 'rejected';

export interface WishRequest extends Auditable {
  id: string;
  doctor_id: string;
  date: string;
  type: WishType;
  position?: string | null;
  priority: WishPriority;
  reason?: string | null;
  status: WishStatus;
  admin_comment?: string | null;
  range_start?: string | null;
  range_end?: string | null;
  user_viewed: boolean;
}

// ── Qualification ──────────────────────────────────────────────────────────

export interface Qualification extends Auditable {
  id: string;
  name: string;
  short_label?: string | null;
  description?: string | null;
  color_bg: string;
  color_text: string;
  category: string;
  is_active: boolean;
  order: number;
}

export interface DoctorQualification extends Auditable {
  id: string;
  doctor_id: string;
  qualification_id: string;
  granted_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
}

export interface WorkplaceQualification extends Auditable {
  id: string;
  workplace_id: string;
  qualification_id: string;
  is_mandatory: boolean;
  is_excluded: boolean;
}

// ── Team role ──────────────────────────────────────────────────────────────

export interface TeamRole {
  id: string;
  name: string;
  priority: number;
  is_specialist: boolean;
  can_do_foreground_duty: boolean;
  can_do_background_duty: boolean;
  excluded_from_statistics: boolean;
  description?: string | null;
  created_date: string;
  updated_date: string;
}

// ── Workplace timeslot ─────────────────────────────────────────────────────

export interface WorkplaceTimeslot extends Auditable {
  id: string;
  workplace_id: string;
  label: string;
  start_time: string;
  end_time: string;
  order: number;
  overlap_tolerance_minutes: number;
  spans_midnight: boolean;
}

// ── System setting ─────────────────────────────────────────────────────────

export interface SystemSetting extends Auditable {
  id: string;
  key: string;
  value?: string | null;
}

// ── Schedule block ─────────────────────────────────────────────────────────

export interface ScheduleBlock extends Auditable {
  id: string;
  date: string;
  position: string;
  timeslot_id?: string | null;
  reason?: string | null;
}

// ── Schedule note ──────────────────────────────────────────────────────────

export interface ScheduleNote extends Auditable {
  id: string;
  date: string;
  position: string;
  content: string;
}

// ── Staffing plan ──────────────────────────────────────────────────────────

export interface StaffingPlanEntry extends Auditable {
  id: string;
  doctor_id: string;
  year: number;
  month: number;
  value: string;
  reason?: string | null;
  note?: string | null;
}

// ── Shift time rule ────────────────────────────────────────────────────────

export interface ShiftTimeRule {
  id: string;
  workplace_id: string;
  work_time_model_id: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  label?: string | null;
  short_code?: string | null;
  spans_midnight: boolean;
  created_at: string;
  updated_at: string;
}

// ── Work time model ────────────────────────────────────────────────────────

export interface WorkTimeModel {
  id: string;
  name: string;
  hours_per_week: number;
  hours_per_day: number;
  is_default: boolean;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Color setting ──────────────────────────────────────────────────────────

export interface ColorSetting extends Auditable {
  id: string;
  key: string;
  color: string;
}
