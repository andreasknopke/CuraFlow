import type { Pool, ResultSetHeader } from 'mysql2/promise';

interface DeleteEmployeeDependentRecordsResult {
  deletedSharedShiftEntries: number;
  deletedAssignments: number;
  deletedTimeAccounts: number;
}

/**
 * Delete all dependent records for a central employee before removing
 * the employee itself. Returns the number of rows deleted per table.
 */
export async function deleteEmployeeDependentRecords(
  dbPool: Pool,
  employeeId: string
): Promise<DeleteEmployeeDependentRecordsResult> {
  const [sharedShiftResult] = await dbPool.execute<ResultSetHeader>(
    'DELETE FROM shared_shift_entry WHERE employee_id = ?',
    [employeeId]
  );
  const [assignmentResult] = await dbPool.execute<ResultSetHeader>(
    'DELETE FROM EmployeeTenantAssignment WHERE employee_id = ?',
    [employeeId]
  );
  const [timeAccountResult] = await dbPool.execute<ResultSetHeader>(
    'DELETE FROM TimeAccount WHERE employee_id = ?',
    [employeeId]
  );

  return {
    deletedSharedShiftEntries: sharedShiftResult?.affectedRows ?? 0,
    deletedAssignments: assignmentResult?.affectedRows ?? 0,
    deletedTimeAccounts: timeAccountResult?.affectedRows ?? 0,
  };
}
