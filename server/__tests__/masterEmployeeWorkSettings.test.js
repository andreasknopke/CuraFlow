import { describe, expect, it, vi } from 'vitest';
import { syncEmployeeWorkSettingsToTenantDoctors } from '../utils/masterEmployeeWorkSettings.js';

function createTenantPool() {
  const calls = [];

  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('FROM INFORMATION_SCHEMA.COLUMNS')) {
        return [[
          { COLUMN_NAME: 'target_weekly_hours' },
          { COLUMN_NAME: 'work_time_model_id' },
        ], []];
      }

      return [{ affectedRows: 1 }, []];
    },
  };
}

describe('syncEmployeeWorkSettingsToTenantDoctors', () => {
  it('propagates central weekly hours and work time model to linked tenant doctors', async () => {
    const tenantPool = createTenantPool();
    const token = { id: 'tenant-1', token: 'secret-token' };
    const withTenantDb = vi.fn(async (receivedToken, callback) => callback(tenantPool, receivedToken));
    const buildRealtimeScope = vi.fn(() => 'tenant:scope');
    const broadcastPlanUpdate = vi.fn();

    const result = await syncEmployeeWorkSettingsToTenantDoctors({
      employee: {
        id: 'employee-1',
        target_hours_per_week: 40,
        work_time_model_id: 'model-40h',
      },
      assignments: [
        {
          tenant_id: 'tenant-1',
          tenant_doctor_id: 'doctor-1',
        },
      ],
      tokens: [token],
      withTenantDb,
      actor: { id: 'admin-1', email: 'admin@example.com' },
      buildRealtimeScope,
      broadcastPlanUpdate,
    });

    expect(withTenantDb).toHaveBeenCalledWith(token, expect.any(Function));
    expect(tenantPool.calls).toEqual([
      {
        sql: expect.stringContaining('FROM INFORMATION_SCHEMA.COLUMNS'),
        params: [],
      },
      {
        sql: 'UPDATE Doctor SET target_weekly_hours = ?, work_time_model_id = ? WHERE id = ?',
        params: [40, 'model-40h', 'doctor-1'],
      },
    ]);
    expect(buildRealtimeScope).toHaveBeenCalledWith('secret-token');
    expect(broadcastPlanUpdate).toHaveBeenCalledWith({
      scope: 'tenant:scope',
      entity: 'Doctor',
      action: 'update',
      recordId: 'doctor-1',
      actor: { id: 'admin-1', email: 'admin@example.com' },
    });
    expect(result).toEqual({
      syncedAssignments: [
        {
          tenant_id: 'tenant-1',
          tenant_doctor_id: 'doctor-1',
          updated_fields: ['target_weekly_hours', 'work_time_model_id'],
        },
      ],
      skippedAssignments: [],
      failedAssignments: [],
    });
  });
});