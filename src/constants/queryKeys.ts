// ---------------------------------------------------------------------------
// React Query key factories — keeps cache keys consistent & grep-able.
// Usage: import { queryKeys } from '@/constants/queryKeys';
//        useQuery({ queryKey: queryKeys.doctors(), ... })
// ---------------------------------------------------------------------------

export const queryKeys = {
  // ── Staff / doctors ────────────────────────────────────────────────────
  doctors: () => ['doctors'] as const,
  workplaces: () => ['workplaces'] as const,
  users: () => ['users'] as const,
  teamRoles: () => ['teamRoles'] as const,
  colorSettings: () => ['colorSettings'] as const,

  // ── Schedule ───────────────────────────────────────────────────────────
  shifts: (month?: string) => (month ? (['shifts', month] as const) : (['shifts'] as const)),
  wishes: (month?: string) => (month ? (['wishes', month] as const) : (['wishes'] as const)),
  scheduleNotes: () => ['scheduleNotes'] as const,
  scheduleBlocks: (month?: string) =>
    month ? (['scheduleBlocks', month] as const) : (['scheduleBlocks'] as const),
  scheduleRules: () => ['scheduleRules'] as const,
  workplaceTimeslots: () => ['workplaceTimeslots'] as const,
  workTimeModels: () => ['workTimeModels'] as const,
  shiftTimeRules: () => ['shiftTimeRules'] as const,
  timeslotTemplates: () => ['timeslotTemplates'] as const,
  demoSettings: () => ['demoSettings'] as const,

  // ── Staffing ───────────────────────────────────────────────────────────
  staffingPlanEntries: (month?: string) =>
    month ? (['staffingPlanEntries', month] as const) : (['staffingPlanEntries'] as const),

  // ── Vacation / training / wish ─────────────────────────────────────────
  trainingRotations: () => ['trainingRotations'] as const,
  allPendingWishes: () => ['allPendingWishes'] as const,
  shiftNotifications: (month?: string) =>
    month ? (['shiftNotifications', month] as const) : (['shiftNotifications'] as const),

  // ── Qualifications ─────────────────────────────────────────────────────
  qualifications: () => ['qualifications'] as const,
  doctorQualifications: (doctorId: string) => ['doctorQualifications', doctorId] as const,
  allDoctorQualifications: () => ['allDoctorQualifications'] as const,
  workplaceQualifications: (workplaceId: string) =>
    ['workplaceQualifications', workplaceId] as const,
  allWorkplaceQualifications: () => ['allWorkplaceQualifications'] as const,

  // ── System ─────────────────────────────────────────────────────────────
  systemSettings: () => ['systemSettings'] as const,
  externalHolidays: (year: number) => ['externalHolidays', year] as const,
  dashboardAlert: (...args: unknown[]) => ['dashboardAlert', ...args] as const,
  user: () => ['user'] as const,

  // ── CoWork ─────────────────────────────────────────────────────────────
  coworkInvites: () => ['coworkInvites'] as const,
  coworkContacts: () => ['coworkContacts'] as const,

  // ── Voice ──────────────────────────────────────────────────────────────
  voiceAliases: () => ['voiceAliases'] as const,

  // ── Master (admin multi-tenant) ────────────────────────────────────────
  masterTenants: () => ['master-tenants'] as const,
  masterStaff: (...args: unknown[]) => ['master-staff', ...args] as const,
  masterEmployees: () => ['master-employees'] as const,
  masterHolidaySettings: () => ['masterHolidaySettings'] as const,
  masterCustomHolidays: () => ['masterCustomHolidays'] as const,
} as const;
