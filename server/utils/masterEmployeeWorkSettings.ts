import type { Pool, RowDataPacket, ResultSetHeader, FieldPacket } from 'mysql2/promise';

export interface Employee {
  id?: string | null;
  target_hours_per_week?: string | number | null;
  model_hours_per_week?: string | number | null;
  work_time_model_id?: string | null;
  vacation_days_annual?: string | number | null;
}

interface TenantAssignment {
  tenant_id: string;
  tenant_doctor_id: string;
  [key: string]: unknown;
}

interface TenantToken {
  id: string;
  token: string;
  name?: string | null;
}

interface Actor {
  id?: string | null;
  email?: string | null;
}

type WithTenantDbCallback = (pool: Pool, token?: TenantToken) => Promise<void>;
type WithTenantDbFn = (token: TenantToken, callback: WithTenantDbCallback) => Promise<void>;

interface BroadcastPlanUpdateEvent {
  scope: string;
  entity: string;
  action: string;
  recordId?: string | null;
  actor?: { id?: string | null; email?: string | null } | null;
}

interface SyncEmployeeWorkSettingsOptions {
  employee: Employee | null | undefined;
  assignments?: TenantAssignment[];
  tokens?: TenantToken[];
  withTenantDb: WithTenantDbFn;
  actor?: Actor | null;
  buildRealtimeScope?: (dbToken: string | null | undefined) => string;
  broadcastPlanUpdate?: (event: BroadcastPlanUpdateEvent) => void;
}

interface ColumnRow extends RowDataPacket {
  COLUMN_NAME: string;
}

interface SyncedAssignment {
  tenant_id: string;
  tenant_doctor_id: string;
  updated_fields: string[];
}

interface SkippedAssignment {
  tenant_id: string;
  tenant_doctor_id: string;
  reason: string;
}

interface FailedAssignment {
  tenant_id: string;
  tenant_doctor_id: string;
  error: string;
}

interface SyncResult {
  syncedAssignments: SyncedAssignment[];
  skippedAssignments: SkippedAssignment[];
  failedAssignments: FailedAssignment[];
}

export function resolveEmployeeTargetWeeklyHours(employee: Employee | null | undefined): number | null {
  const explicitWeeklyHours = Number(employee?.target_hours_per_week);
  if (Number.isFinite(explicitWeeklyHours) && explicitWeeklyHours > 0) {
    return explicitWeeklyHours;
  }

  const modelWeeklyHours = Number(employee?.model_hours_per_week);
  if (Number.isFinite(modelWeeklyHours) && modelWeeklyHours > 0) {
    return modelWeeklyHours;
  }

  return null;
}

export async function syncEmployeeWorkSettingsToTenantDoctors({
  employee,
  assignments = [],
  tokens = [],
  withTenantDb,
  actor = null,
  buildRealtimeScope,
  broadcastPlanUpdate,
}: SyncEmployeeWorkSettingsOptions): Promise<SyncResult> {
  const linkedAssignments = assignments.filter(
    (assignment) => assignment?.tenant_id && assignment?.tenant_doctor_id
  );
  const resolvedWeeklyHours = resolveEmployeeTargetWeeklyHours(employee);

  if (!employee?.id || linkedAssignments.length === 0) {
    return {
      syncedAssignments: [],
      skippedAssignments: [],
      failedAssignments: [],
    };
  }

  const tokenById = new Map(tokens.map((token) => [String(token.id), token]));
  const doctorColumnCache = new Map<string, Set<string>>();
  const syncedAssignments: SyncedAssignment[] = [];
  const skippedAssignments: SkippedAssignment[] = [];
  const failedAssignments: FailedAssignment[] = [];

  for (const assignment of linkedAssignments) {
    const token = tokenById.get(String(assignment.tenant_id));
    if (!token) {
      skippedAssignments.push({
        tenant_id: assignment.tenant_id,
        tenant_doctor_id: assignment.tenant_doctor_id,
        reason: 'tenant_not_found',
      });
      continue;
    }

    try {
      await withTenantDb(token, async (pool) => {
        let doctorColumns = doctorColumnCache.get(String(token.id));

        if (!doctorColumns) {
          const [columnRows] = await pool.execute<ColumnRow[]>(
            `SELECT COLUMN_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_NAME = 'Doctor'
               AND TABLE_SCHEMA = DATABASE()
               AND COLUMN_NAME IN ('target_weekly_hours', 'work_time_model_id', 'vacation_days')`
          );

          doctorColumns = new Set(columnRows.map((row) => row.COLUMN_NAME));
          doctorColumnCache.set(String(token.id), doctorColumns);
        }

        const updates: string[] = [];
        const params: (string | number | null)[] = [];

        if (doctorColumns.has('target_weekly_hours')) {
          updates.push('target_weekly_hours = ?');
          params.push(resolvedWeeklyHours);
        }

        if (doctorColumns.has('work_time_model_id')) {
          updates.push('work_time_model_id = ?');
          params.push(employee.work_time_model_id || null);
        }

        if (doctorColumns.has('vacation_days') && employee.vacation_days_annual != null) {
          updates.push('vacation_days = ?');
          params.push(Number(employee.vacation_days_annual));
        }

        if (updates.length === 0) {
          skippedAssignments.push({
            tenant_id: assignment.tenant_id,
            tenant_doctor_id: assignment.tenant_doctor_id,
            reason: 'missing_columns',
          });
          return;
        }

        params.push(assignment.tenant_doctor_id);
        await pool.execute<ResultSetHeader>(`UPDATE Doctor SET ${updates.join(', ')} WHERE id = ?`, params);

        syncedAssignments.push({
          tenant_id: assignment.tenant_id,
          tenant_doctor_id: assignment.tenant_doctor_id,
          updated_fields: updates.map((update) => update.split(' = ')[0]),
        });

        if (buildRealtimeScope && broadcastPlanUpdate) {
          broadcastPlanUpdate({
            scope: buildRealtimeScope(token.token),
            entity: 'Doctor',
            action: 'update',
            recordId: assignment.tenant_doctor_id,
            actor,
          });
        }
      });
    } catch (error) {
      failedAssignments.push({
        tenant_id: assignment.tenant_id,
        tenant_doctor_id: assignment.tenant_doctor_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    syncedAssignments,
    skippedAssignments,
    failedAssignments,
  };
}
