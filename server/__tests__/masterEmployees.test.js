import { describe, expect, it } from 'vitest';
import { deleteEmployeeDependentRecords } from '../utils/masterEmployees.js';

function createMockDbPool() {
  const calls = [];

  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });

      if (sql.startsWith('DELETE FROM shared_shift_entry')) {
        return [{ affectedRows: 2 }, []];
      }
      if (sql.startsWith('DELETE FROM EmployeeTenantAssignment')) {
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith('DELETE FROM TimeAccount')) {
        return [{ affectedRows: 3 }, []];
      }

      return [{ affectedRows: 0 }, []];
    },
  };
}

describe('deleteEmployeeDependentRecords', () => {
  it('removes cross-tenant shifts before other employee-dependent master rows', async () => {
    const dbPool = createMockDbPool();

    const result = await deleteEmployeeDependentRecords(dbPool, 'employee-1');

    expect(dbPool.calls).toEqual([
      {
        sql: 'DELETE FROM shared_shift_entry WHERE employee_id = ?',
        params: ['employee-1'],
      },
      {
        sql: 'DELETE FROM EmployeeTenantAssignment WHERE employee_id = ?',
        params: ['employee-1'],
      },
      {
        sql: 'DELETE FROM TimeAccount WHERE employee_id = ?',
        params: ['employee-1'],
      },
    ]);

    expect(result).toEqual({
      deletedSharedShiftEntries: 2,
      deletedAssignments: 1,
      deletedTimeAccounts: 3,
    });
  });
});
